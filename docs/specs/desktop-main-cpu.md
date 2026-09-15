# Desktop main-process CPU ceiling — root cause, measurements, fix plan

**Status:** scoping + measured prototype. **UNCOMMITTED.** Measured 2026-09-15 on
branch `ui/agents-tab-polish`, against a copy of the live store
(`~/Library/Application Support/dopl-desktop/config.json`, 141 KB, 65 retained ended records).

**Supersedes the working hypothesis of 2026-09-06** (recorded in
`project_dopl_main_process_cpu_ceiling`), which attributed the ceiling to per-token
stdout → IPC serialization. **That hypothesis is wrong.** The profile that "symbolized
badly" symbolizes cleanly; it names a different path, and the per-token IPC lane is not
in the top 20 by self time.

---

## 0. The answer in three sentences

The main thread is not spending its CPU on agent output. It is spending it on
`main/session-summary.js › reportList`, which calls `main/agent-names.js › all` **twice
for every session row it projects** — and `all()` is an `electron-store` read, which in
`conf` means `fs.readFileSync` + `JSON.parse` of the **entire config file, every call,
with no cache**.

At the retention cap (`main/agent-history.js › MAX_HISTORY` = 200) that is **~400 full
reads and parses of a ~200 KB file, 5 times a second** — 142–254 ms of main-thread work
against a 200 ms `PUSH_COALESCE_MS` timer, i.e. the main thread is saturated **before any
agent produces a single token**.

**The cost is driven by how many agents have ENDED and are still retained, not by how
many are running.** Agent count is a proxy, which is why it looked like a
concurrency ceiling.

---

## 1. The path, traced statically

Symbol anchors per `CLAUDE.md` (never bare line numbers). Line numbers appear only where
quoted from the profiler's own output.

### 1a. Agent stdout → renderer (the lane that was suspected — it is *not* the hot one)

| Hop | Site | Per-token work |
|---|---|---|
| SDK stream read | `node_modules/@anthropic-ai/claude-agent-sdk/sdk.mjs › readMessages` | line-split + `JSON.parse` of one SDK message — **inside the SDK**, off a pipe |
| adapter normalize | `main/runtime/claude/normalize.js`, `main/runtime/{codex,cursor}/normalize.js` | pure; builds a CoreEvent (`main/runtime/events.js`) |
| engine dispatch | `main/session-engine.js › dispatch` | reducer apply + `sessionSummary.touch()` (arms a timer; does **not** project) |
| narration append | `main/session-narration.js` → `main/narration-ring.js › push` | ring append, then a **full-ring rescan** to enforce `RING_CHAR_BUDGET` |
| narration flush | `main/session-narration.js › flush`, `sendToWindows` | `webContents.send('dopl:session-narration', {sessionKey, entries})` — **the whole ring**, per dirty session, per live window, ≤5 Hz |
| summary flush | `main/session-summary.js › flush`, `sendToWindows` | `webContents.send('dopl:sessions', {sessions})` — **full snapshot of every row**, per live window, ≤5 Hz |
| preload → SPA | `dopl-desktop-app/renderer/app-preload.js` (`SESSIONS_EVENT`, `NARRATION_EVENT`) | one shared `ipcRenderer.on` fanned to page callbacks |
| SPA | `apps/desktop-ui/src/lib/dopl-bridge.ts › sessions.onSummaries`, consumed in `apps/desktop-ui/src/pages/agent-window/index.tsx` | full-list replace |

**Copies of one output token before React sees it:** 4 — (1) pipe buffer → JS string in the
SDK, (2) `JSON.parse` into an SDK message, (3) normalize into a CoreEvent + ring entry,
(4) structured clone into the Mojo message pipe on `webContents.send`. There is **no**
per-token `JSON.stringify` in main, **no** per-token disk write, and **no** per-token
HTTP.

**`session-state-push.js` is confirmed state-change driven**, as suspected. `drain` gates
on a `setDigest` comparison, then a `telemetry.stateDigest` comparison, then
`telemetry.floorAllows` (a cadence floor). Churn inside the window is not written and its
digest is not recorded. It does **not** push per token.

**Fan-out to N windows** is real but bounded: `main/app-windows.js › liveWindows` (SPA +
`popout-window.js › MAX_POPOUTS` + `agent-window.js › MAX_AGENT_TABS`, ≤9).

⚠ Two real, *secondary* costs live on this lane, both already documented in-tree and
neither in the top 20: the narration flush sends **the whole ring, not a delta**
(`narration-ring.js › RING_CHAR_BUDGET`'s own note names "send a delta" as the unfixed
half), and the summary flush sends a **full snapshot, not a delta**. See §3, steps 3–4.

### 1b. The hot path (what the profile actually shows)

```
session-summary.js › touch          (armed on every dispatch; setTimeout PUSH_COALESCE_MS = 200 ms)
  └─ session-summary.js › flush
       └─ session-summary.js › reportList
            ├─ for each LIVE session   → liveSummary
            │     ├─ agent-names.js › displayNameFor      → all() → store.get → conf `get store`
            │     └─ agent-names.js › descriptionForAgent → all() → store.get → conf `get store`
            └─ retainedEnded() → agent-history.js › listEnded → loadAll() → store.get   [1 read]
                  └─ for each ENDED record → endedSummary
                        ├─ agent-names.js › displayNameFor      → all() → store.get
                        └─ agent-names.js › descriptionForAgent → all() → store.get
```

And `conf`'s `get store` (`node_modules/conf/dist/source/index.js`) is:

```js
get store() {
    const data = fs.readFileSync(this.path, ... 'utf8');
    const dataString = this._encryptData(data);
    const deserializedData = this._deserialize(dataString);   // JSON.parse
    ...
}
```

**No cache. Every `.get()` is a full file read plus a full `JSON.parse`.**

**Reads per projection = `1 + 2·(ended) + 2·(live)`.**

⚠ `main/agent-names.js › displayNameFor`'s own docblock says *"Reads the whole map once
per flush, not once per session."* **That sentence has been false since the `description`
field joined it (2026-08-27)** — it doubled the per-row reads and nothing re-read the
claim. This is a code/comment disagreement worth a finding (see §5).

⚠ **Why the test suite never caught it:** `test/_session-summary-harness.mjs` *stubs*
`displayNameFor` / `descriptionForAgent` to `() => names.value` — deliberately, and for a
good reason (`agent-names.js` opens an electron-store on require). The stub replaces the
entire cost with a constant, so every one of the 3220 tests passes at zero cost on the
line that saturates the main thread in production.

---

## 2. Measurements

### 2a. Top 5 by SELF time — real symbols, from the existing capture

`~/dopl-perf/dopl-main-1788739235261.cpuprofile` (20.1 s, 152 511 samples, captured
2026-09-06 against `/Applications/Dopl.app`). Line numbers are the profile's own, against
that build's `app.asar`.

| % self | Function | File:line (profile's own) |
|---|---|---|
| **26.60%** | `Conf._deserialize` (`JSON.parse`) | `node_modules/conf/dist/source/index.js:67` |
| **14.12%** | `readFileSync` | `node:fs:434` |
| **7.47%** | `readFileUtf8` (native) | `:0` |
| 0.28% | `(garbage collector)` | `:0` |
| 0.10% | `Conf._serialize` | `node_modules/conf/dist/source/index.js:68` |

Idle was 50.96%. **48.2% of wall-clock — i.e. ~98% of all busy CPU — is reading and
parsing the electron-store file.** The other two captures in `~/dopl-perf/` were taken on
an idle app (97.98% / 98.67% idle) and show only the auth-token store read; they are not
load samples.

On-stack (total) attribution, same capture, filtered to app code — this is the call tree
above, confirmed:

| % on stack | Frame |
|---|---|
| 48.24% | `conf › get store` |
| 46.62% | `main/session-summary.js › flush` |
| 46.18% | `main/session-summary.js › reportList` |
| **45.86%** | **`main/agent-names.js › all`** |
| 44.19% | `main/session-summary.js › endedSummary` |
| 22.95% / 22.93% | `agent-names.js › displayNameFor` / `› descriptionForAgent` |

The per-token lane appears at **0.07%** (`sdk.mjs › readMessages`) — three orders of
magnitude below the store reads.

### 2b. Reproduced out-of-app, driving the real modules

Harness: `/private/tmp/claude-501/.../scratchpad/bench-{flush,scale}.cjs`. It stubs only
`electron` (via a `Module._resolveFilename` hook) and requires the **real**
`main/session-summary.js`, `main/agent-names.js` and `main/agent-history.js` against a
**copy** of the real store. `fs.readFileSync` is wrapped to count reads of the config
path. Nothing touches the running app.

Live store as it stands today (65 ended records, 141 KB), 3 live agents:

```
store file reads per reportList() = 137   (19.78 MB read + parsed)
per flush: 39.0 ms  →  19.5% of one core at the 5 Hz PUSH_COALESCE_MS ceiling
```

Scaling by retained-history count, at 3 live agents (synthesized from the real records'
shape, so file growth is honest):

| ended records | config.json | reads/flush | ms/flush | % of one core @5 Hz | disk+parse |
|---|---|---|---|---|---|
| 0 | 79 KB | 7 | 0.8 | 0.4% | 3 MB/s |
| 25 | 94 KB | 57 | 8.1 | 4.0% | 27 MB/s |
| **65 (today)** | 119 KB | 137 | 24–39 | **12–19%** | 83 MB/s |
| 100 | 141 KB | 207 | 47–53 | 24–26% | 149 MB/s |
| 150 | 172 KB | 307 | 88.5 | 44% | 270 MB/s |
| **200 (`MAX_HISTORY`)** | 203 KB | 407 | **142–254** | **71–127%** | **424 MB/s** |

**The curve is quadratic** — reads/flush grows linearly with retained records *and* each
read costs more because the same records grow the file.

At the cap, one projection (142–254 ms) **exceeds the 200 ms coalesce timer**, so the
timer re-fires into a thread that never finished the last one. That is the lag, and the
"it will crash at ~9 agents" intuition.

Live-agent count alone is nearly flat — **+2 reads per agent** (1 → 15 agents moves
19% → 23% at 65 records). Agent count matters mainly because **every agent that ends adds
a record and grows the file.**

---

## 3. Fix plan, costed

Target after step 1: **main CPU from this path is flat in both agent count and history
size — under 1% of one core.** The sustainable agent count stops being bounded by this
path at all; the next ceiling (§3, step 3) has not been measured yet.

### Step 1 — memoize the name-map read per projection ✅ PROTOTYPED AND MEASURED

- **What:** `main/agent-names.js › all` caches the map for the current macrotask;
  invalidated explicitly after every write this module makes.
- **Expected reduction:** reads/flush `1 + 2E + 2L` → **2**, constant.
- **Measured:** see §4. **254 ms → 0.6 ms at the cap (~420×).**
- **Files touched:** `main/agent-names.js` only. No signature changes, no seam moved.
- **Risk: very low.** `reportList()` is fully synchronous, so the map cannot change
  between its first and last read — the memo returns the identical value the old code
  re-derived N times. `agent-names.js` is the **only writer of `NAMES_KEY`** (verified:
  `rename`, `describe`, `clear` are the three write sites), and all three now invalidate,
  so a rename is visible to the very next read. Names stay **read live across flushes**
  (200 ms apart), which is the property `endedSummary`'s docblock requires.
- **Invariants checked:** nothing in `docs/INVARIANTS.md` constrains the *caching* of a
  local display-name lookup. §"agent mentions" (`agent-names.js` slugged custom name +
  `agent-<id>`) governs *resolution and tinting*, not read frequency, and is untouched.
  Narration ordering is untouched (different module). The windowless-session rules are
  untouched. `main/agent-handles.js › nameFor` also calls `displayNameFor` and gets the
  same speedup for free, with the same safety argument.
- **Tests:** `npm test` in `dopl-desktop-app` — **3220/3220 pass**. `npx eslint
  main/agent-names.js` — clean. File is 278 lines, under the 500 cap.
- **Test strategy to add before shipping:** a regression test that pins the read count.
  `test/_session-summary-harness.mjs` cannot host it (it stubs the store — that stub is
  exactly why this shipped), so it needs a **new** suite that requires the real
  `agent-names.js` with `electron` stubbed and asserts
  `reads(reportList()) === 2` independent of record count. That test is the durable half
  of this fix: without it the next field added beside `displayName` reintroduces the bug.

### Step 2 — same memo for `main/agent-history.js › loadAll` (small, do it with step 1)

- `loadAll()` is 1 read per projection today, but it is called per `historyFor` too, and
  `listEnded()` sorts the whole map on every projection. **Expected reduction: ~1 read/flush
  plus the repeat `historyFor` reads.** Marginal after step 1; worth doing for symmetry
  and because it removes the last unbounded store read from the projection.
- **Risk: low**, same argument. **Files:** `main/agent-history.js`.

### Step 3 — narration and summary deltas instead of full snapshots

- **What:** `session-narration.js › flush` sends the whole ring (≤60 KB/session/window,
  ≤5 Hz, ≤9 windows); `session-summary.js › flush` sends every row. Send appended entries
  / changed rows instead.
- **Expected reduction: NOT MEASURED — see §6.** `narration-ring.js › RING_CHAR_BUDGET`'s
  note already names this as the unfixed half of the 2026-08-30 17 GB incident, so the
  cost is known to be real, but it is native structured-clone cost that my out-of-app
  harness cannot observe. **Measure before building.**
- **Risk: medium.** Deltas mean the renderer holds authoritative state and a dropped frame
  desynchronizes it; needs a sequence number and a resync path. This is where narration
  **ordering** becomes a real invariant concern, unlike steps 1–2.
- **Files:** `main/session-narration.js`, `main/session-summary.js`,
  `dopl-desktop-app/renderer/app-preload.js`, `apps/desktop-ui/src/lib/dopl-bridge.ts`,
  `apps/desktop-ui/src/pages/agent-window/index.tsx`.

### Step 4 — skip pushes when no window is watching

- `sendToWindows` already returns false with no live windows, but `reportList()` runs
  **before** that check in `flush()`. After step 1 the projection is ~0.6 ms so this is no
  longer urgent; it becomes worthwhile only if step 3's measurement says the send itself
  dominates.
- **Risk: low**, but it interacts with the **windowless-session rules** — a windowless
  session must still progress with no window bound, so this may only skip the *send*,
  never the state transition or the `emitChange` subscriber that
  `session-state-push.js` rides. Read those rules before touching it.

### Steps explicitly NOT recommended

- **Coalescing agent output chunks before `webContents.send`** — the 2026-09-06
  recommendation. The narration lane is already coalesced at 200 ms and digest-gated, and
  it profiles at 0.07%. **This would have bought nothing.**
- **Moving parse/serialize to a utility process or worker** — a large, risky change
  against a cost that turns out to be 0.6 ms after a 20-line memo.
- **Lowering `MAX_HISTORY`** — treats the symptom, loses ended-agent cards Samuel
  explicitly asked for (2026-08-22 ruling), and leaves the quadratic in place.

### Recommended order

**Step 1 + its regression test first** (it is the whole problem), **step 2 in the same
change**, then **measure** before deciding whether step 3 is worth its risk.

---

## 4. Prototype — before / after

Implemented behind a kill switch: **`DOPL_NAMES_CACHE=0` restores the old behaviour.**
Default is ON. Marked in-file with `⚠⚠ PROTOTYPE — UNCOMMITTED, 2026-09-15`.
**One file: `main/agent-names.js`.**

3 live agents, same harness, same store copies:

| ended records | before (`DOPL_NAMES_CACHE=0`) | after | speedup |
|---|---|---|---|
| 65 (today) | 137 reads, 30.5 ms/flush, **15.2%** core | **2 reads, 0.3 ms, 0.1%** | ~100× |
| 100 | 207 reads, 52.5 ms/flush, **26.2%** core | **2 reads, 0.7 ms, 0.3%** | ~75× |
| **200 (cap)** | 407 reads, **254.5 ms/flush, 127% core** | **2 reads, 0.6 ms, 0.3%** | **~420×** |

Live-agent scaling after the fix, at the 200-record cap — **flat**:

| live agents | 1 | 3 | 8 | 15 |
|---|---|---|---|---|
| ms/flush | 0.6 | 0.9 | 0.8 | 0.6 |
| % of one core @5 Hz | 0.3% | 0.5% | 0.4% | 0.3% |

Disk+parse volume: **424 MB/s → 2 MB/s.**

Gates: `npm test` **3220/3220 pass**; `npx eslint main/agent-names.js` clean; 278 lines.

---

## 5. Follow-up owed

- **File a finding** for the code/comment disagreement: `agent-names.js › displayNameFor`
  claims "once per flush, not once per session" and has done the opposite since
  2026-08-27. Highest id on `master` is **F-700**, so **F-701** — but re-derive across
  live branches first, per `docs/REFACTOR-FINDINGS.md`'s allocation rule.
- **Add the read-count regression test** (§3 step 1). Without it this recurs.
- The finding should also record the **harness blind spot**: a stub that replaces a
  store-backed function with a constant hides an unbounded cost from every suite that
  shares it.

---

## 6. What I could NOT verify

1. **The live main-process CPU after the fix.** The dev app is running and was not
   restarted (per instructions), and main-process changes need a restart to load. All
   before/after numbers are from the out-of-app harness driving the real modules against a
   copy of the real store. **The fix is unproven in the running app.**
2. **Step 3's payoff.** `webContents.send`'s structured clone is native Mojo work; my Node
   harness cannot measure it, and I did not attach to the running app to avoid disturbing
   it. The 0.07% figure for the SDK read lane is from the 2026-09-06 capture, which was
   taken at a load I did not set.
3. **The exact store state during the 2026-09-06 capture.** 48.2% there vs ~19% predicted
   for today's 65 records implies that machine had more retained records and/or a larger
   file at capture time — consistent with the curve (100–150 records), but not directly
   measured.
4. **The 53.6% / 91.5% figures for 3 / 8 agents** quoted from 2026-09-06 could not be
   reproduced as stated; they are consistent with this root cause, but they conflate
   concurrent-agent count with accumulated history, which the curve in §2b shows are
   different variables.
5. **Codex / Cursor adapters** were read for the trace but not profiled — they share the
   same `session-summary` projection, so step 1 helps them identically, but their
   per-event normalize cost is unmeasured.

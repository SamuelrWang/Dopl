# GHOST-CAPTURE — evidence for message #1759, taken off the RUNNING processes

Captured 2026-09-15 ~17:10 local (00:10Z) by `cn19np53`, read-only, **before the pending
desktop restart**. Everything below is copied from live processes and on-disk logs that the
restart will either overwrite or invalidate. Nothing was started, killed or written to.

Companion to the negative result posted at #1819 (every deterministic client-side suspect
disproved against current source).

---

## ⚠ RETRACTED HEADLINE — "the running UI is a six-day-old build" WAS WRONG

**This section originally claimed the renderer was serving a 2026-09-09 production bundle, and
that claim drove a runbook amendment (#1833). It is false. Recorded rather than deleted,
because it was acted on.**

What I saw, and why it misled me:

```
$ cat .next/BUILD_ID          → 4_76J7mnzF2ZinuBpTcTa
$ stat .next/BUILD_ID         → 2026-09-09T03:51:18
$ ps -o command -p 47450      → next-server (v16.2.2)
```

A `BUILD_ID` dated Sep 9 beside a process called `next-server` reads as a stale production
server. **It is neither.** The parent process settles it:

```
$ ps -o pid,ppid,command -p 47450
47450 98352 next-server (v16.2.2)
$ ps -o pid,ppid,command -p 98352
98352 98319 node .../node_modules/.bin/next dev --webpack
```

`next dev` — a DEV SERVER, which compiles from the working tree per request. `.next/dev/`
carries today's mtime (Sep 15 16:59, when it started); `BUILD_ID` and the prod manifests beside
it are **leftovers from an old `next build` on Sep 9** that nothing serves.

⚠ **THE METHOD ERROR IS THE ONE WORTH KEEPING.** I read an ARTIFACT (`BUILD_ID`) and inferred a
PROCESS, when the process was one `ps` away and answers directly. That is the same mistake as
trusting a slug over an id: a plausible identifier read without checking what it actually names.

### Consequences of the retraction

1. **No build is needed.** A `Cmd+R` reload picks up current source. The runbook's "build both
   surfaces first" amendment, which came from this section, is unnecessary for the renderer.
2. **The #1819 audit STANDS, and its retraction is itself retracted.** The render path
   (`message-window.ts`, `use-channel-messages.ts`, `view-model-rows.ts`,
   `transcript-line-budget.ts`, the artifact fold) was last touched at **2026-09-14 10:03**
   (`66d8832f`), and NO commit has touched it since the ghost:

   ```
   $ git log --oneline --since="2026-09-15T13:11:32-07:00" -- <render path files>
   (empty)
   ```

   So the code serving at 20:11:32Z is byte-for-byte the code I audited. Every suspect cleared
   at #1819 is **genuinely** cleared, for the version that actually ran.
3. The ghost therefore remains an open unknown **in current source** — not something a newer
   commit may have already fixed.

### ⚠ AND CLAUSE 2 ABOVE WAS STATED TOO WIDELY — k2k2q9fh's catch, conceded

I wrote "nothing has touched the render path since the ghost". That sentence was **scoped to the
four files I named** and should have said so, because three commits landed on row-RENDERING
code hours AFTER the ghost:

| commit | local time | files |
|---|---|---|
| `f122080a` | 2026-09-15 16:49:31 | `attribution-pill.tsx`, `authored-row.tsx`, `message-pane-header.tsx`, `lib/agent-mentions.ts` |
| `667076e0` | 2026-09-15 17:00:17 | `attribution-pill.tsx`, `authored-row.tsx` |
| `d695c478` | 2026-09-15 17:03:56 | `attribution-pill.tsx`, `authored-row.tsx` |

**When the #1819 audit ran: AFTER 17:03.** Its probe is timestamped `Start at 17:06:54` and
`HEAD` was `d695c478`, so **all three were in the tree I read.** The ghost is 13:11:32 local —
three and a half hours EARLIER.

Two things follow, and they point opposite ways:

- **None of the three can be the CAUSE.** They postdate the event. The comfortable reading
  ("already fixed since") stays dead for the same reason, in reverse.
- 🔒 **BUT THERE IS NOW A SURFACE NOBODY HAS READ AT THE RIGHT VERSION.** `authored-row.tsx`
  and `attribution-pill.tsx` decide how an agent-authored row is drawn. They were never in the
  #1819 scope — and the version that RAN at 20:11:32Z is the pre-`f122080a` one, which no audit
  in this incident has looked at. Whoever takes the ghost next should start there:

  ```
  git show f122080a^:src/features/channels/components/authored-row.tsx
  git show f122080a^:src/features/channels/components/attribution-pill.tsx
  ```

  ⚠ Both rows are agent-authored and identical in every routed field, so a defect here would
  have to be state- or order-dependent rather than row-shaped — the same constraint #1819
  established, now pointed at the one layer it never covered.

**What survives unchanged:** the five mechanisms actually tested at #1819 — the window join,
the line budget, the artifact fold, the transcript filter and `channelRows`' drop paths — all
live in files last touched **2026-09-14 10:03 or earlier**, so those clearances describe the
code that ran, exactly.

---

## THE PRE-`f122080a` READ — the last unread surface: **CLEARED**

Audited at the version that ran (`git show f122080a^:`), hunting state- or order-dependent
paint failures only; row-shaped causes are excluded by the field diff.

**`authored-row.tsx › AuthoredRow` cannot drop a row.** It has no `return null`, no early exit
and no conditional that omits the row: both branches — accented and bare — return an
`<article data-message-id={id}>`. A row that reaches it paints, always.

**`attribution-pill.tsx › AttributionPill` cannot either.** Same shape: both branches return an
element (`<button>` when openable, `<span>` otherwise).

⚠ **AND NEITHER HOLDS STATE, WHICH IS WHY A STATE-DEPENDENT FAILURE IS STRUCTURALLY IMPOSSIBLE
HERE.** No `useState`, no `useEffect`, no `useMemo`, no index lookup — every input (`agentName`,
`accent`, `routedTo`) arrives ALREADY RESOLVED from the caller, by these files' own stated
contract (*"this shell takes no index"*). Pure props in, element out: the same props render the
same row on every pass, in any order.

Their helpers are total, so there is no throw path either:

- `bits.tsx › agentAccent` — string hash into a fixed array, modulo-indexed.
- `agent-name.ts › agentFaceName` — `null` / `undefined` / whitespace all fold to a default.
- `attribution-pill.tsx › attributionName` — every branch returns a string.

⚠ **A THROW IS ALSO EXCLUDED BY OBSERVATION, NOT ONLY BY READING.** There is no per-row error
boundary, so a render throw takes the whole transcript subtree — and Samuel read #1758 and
#1760 around the gap. One row cannot fail alone in this layer.

### What that leaves — the residual is DATA, not RENDER

Every deterministic client path is now cleared **at the exact version that ran**: the window
join, the line budget, the artifact fold, the filter, `channelRows`' drop paths, and now the
row shell and its pill. So #1759's absence was not a rendering decision. It points one layer
back: **what was in the `messages` array the row builder walked** — i.e. whether that
transcript query re-ran and what its result contained at 20:11:32Z.

That is precisely the half of discriminator 1 this machine does not log (no renderer log, no
next-server access log), and it is why **the scroll-test is the only remaining source of
signal**: if #1759 paints on a re-query of the same running code, the data path healed and the
render layer was never at fault — consistent with everything above.

---

# CLOSED — final verdict

**Scroll-test result (Samuel, 2026-09-15, ~17:2x local): #1759 PAINTS on the running client,
with no reload.** Same process, same source, same row that was invisible at 13:11.

> **VERDICT: a transient data-path event, self-healed by a later refetch. The render layer is
> exonerated at the version that ran.**

The row was always whole in `channel_messages`, the transport provably delivered it (both
`realtime insert` + `fan-out` lines in `listener.log`), and every deterministic path from the
query result to the DOM is cleared against the exact code that was executing. What briefly did
not happen was the transcript holding #1759 in the array it rendered from; a later re-query
fixed it without anyone changing anything.

## Candidate mechanism — HMR re-render (k2k2q9fh), and why it is a candidate and not the answer

The renderer is `next dev --webpack`, so every save hot-reloads the module graph and remounts
the affected tree. Three commits landed on the transcript's own row components **hours after
the ghost and hours before the scroll-test**:

| local time | commit | files |
|---|---|---|
| 13:11:32 | — | **the ghost** |
| 16:49:31 | `f122080a` | `attribution-pill.tsx`, `authored-row.tsx`, `message-pane-header.tsx`, `agent-mentions.ts` |
| 17:00:17 | `667076e0` | `attribution-pill.tsx`, `authored-row.tsx` |
| 17:03:56 | `d695c478` | `attribution-pill.tsx`, `authored-row.tsx` |
| ~17:2x | — | **scroll-test: paints** |

Each of those edits (and every intermediate save behind them) forced an HMR remount of the
transcript, which re-runs the query and rebuilds the window from a fresh page. That is a
sufficient explanation for the healing.

⚠ **BUT THE TEST CANNOT SEPARATE IT FROM AN ORDINARY REFETCH, AND SAYING SO IS THE POINT.** The
scroll-test ran *after* all three, so "an HMR remount healed it" and "any of the dozens of
realtime doorbells in the intervening four hours healed it" predict the identical observation.
A scroll-test run before 16:49 would have discriminated; that window is gone. Both candidates
are data-path/state events, so the verdict above holds either way — but the MECHANISM is
**undetermined**, and no evidence still on this machine can determine it.

## What remains unknowable

**Whether the transcript query re-ran at 20:11:32Z, and what its result contained.** Nothing on
this machine records it: `listener.log` is the Electron MAIN process, the renderer keeps no
fetch log, and `next dev` writes no access log. So the decisive question — *did the refetch not
happen, or did it happen and come back without #1759?* — has no artifact behind it, and never
did. That is the reason this trace ends in a bounded unknown rather than a root cause, and it
is a gap in INSTRUMENTATION, not in the investigation.

## The one improvement that would make a recurrence diagnosable

**A renderer-side transcript fetch log.** One line per transcript query, dev-mode only, from
`hooks/use-channel-messages.ts`: timestamp, what triggered it (doorbell / mount / scroll),
the `before` cursor, and the **seq range + row count returned**. Today a missing row leaves no
trace anywhere; with that line, the transcript above would have read either *"no fetch between
20:11:32 and 20:11:50"* or *"fetched, returned 1729..1760, 32 rows"* — and one of those two
strings is the whole answer, available in seconds instead of four hours.

⚠ It also generalises past this bug: the same line makes the `isContiguous` window-drop
(`message-window.ts`, which discards loaded history *by design* and says nothing) visible for
the first time. That silent discard is real, is documented in its own docblock, and is
currently unobservable in production — the same disease as the dropped directions and the
invisible gate banner: **a lane that drops quietly**.

## Not a fix, and deliberately

No code was written for this bug at any point. Every suspect was disproved rather than patched,
and two of this file's own claims (the "stale bundle", the over-wide "render path untouched")
were retracted in place. The honest close is: **no defect located in current source; the
reproduction window has closed; the instrumentation to catch a recurrence is named above and
does not exist yet.**

## Process inventory at capture time

```
$ ps -o pid,lstart,command -p 44049 -p 19986 -p 47450
  PID STARTED
44049 Tue Sep 15 01:34:03 2026   electron  (main process — predates ALL of today's commits)
19986 Tue Sep 15 14:25:22 2026   electron  (later helper)
47450 Tue Sep 15 16:59:22 2026   next-server v16.2.2  (serving the Sep 9 build)
```

Electron main has been up since **01:34 local**, i.e. before `f8ccf07d` (badge identity),
`9cc24b5e` (slug refusal) and the rest of today — which is the separate, already-known reason
those ship only on restart.

## Discriminator 1 — did the doorbell reach the machine? YES, for BOTH rows

`~/Library/Application Support/dopl-desktop/listener.log`, verbatim, UTC:

```
2026-09-15T20:11:32.468Z namecache loaded 2 ws fidaris
2026-09-15T20:11:32.877Z realtime insert e7998a94 ch bb0f57db        ← #1759 lands
2026-09-15T20:11:33.078Z realtime wake bb0f57db (loop=hit)
2026-09-15T20:11:35.781Z fan-out bb0f57db seq 1759 fed 2 of 3   verdict reciprocal thread
2026-09-15T20:11:45.119Z session gate: dopl_channel op=send allow auto-outbound …
2026-09-15T20:11:48.782Z session-state push: stored 3 row(s) ws e7998a94
2026-09-15T20:11:50.250Z realtime insert e7998a94 ch bb0f57db        ← #1760 lands
2026-09-15T20:11:50.561Z realtime wake bb0f57db (loop=hit)
2026-09-15T20:11:54.028Z fan-out bb0f57db seq 1760 fed 2 of 3   verdict reciprocal thread
```

Both rows produced an identical `realtime insert` + `realtime wake (loop=hit)` + `fan-out …
fed 2 of 3 verdict reciprocal thread`. **The two are indistinguishable in the transport layer
as well as in the row** — the same result #1819 reached from `channel_messages`.

For contrast, the immediately preceding human post takes a different lane, which is what a
*discriminating* log line looks like:

```
2026-09-15T20:11:03.748Z fan-out bb0f57db seq 1758 fed 1 of 3  skipped:2 (not addressed) verdict agent to:c65ym2fl
```

⚠ **WHAT THIS LOG CANNOT ANSWER, STATED PLAINLY.** `listener.log` is the MAIN process. The
transcript's refetch is an HTTP GET issued by the RENDERER, and nothing on this machine records
it — no renderer log, no next-server access log. So: **the signal demonstrably reached the app
for both rows; whether the renderer re-ran its query is unrecorded.** That half of
discriminator 1 is not capturable after the fact, and the restart does not change that.

## Server-side, re-confirmed

`channel_messages` #1759 vs #1760 differ only in `body`, `id`, `client_msg_id` and
`metadata.summary`. `kind=message`, `author_kind=agent`, `author_user_id`, `session_id`,
`recipient_user_ids=[samuel]`, `recipient_agent_ids=[]`, `delivery=delivered`,
`wake_verdict=reciprocal` are identical. The row reads back whole over MCP.

## What is still worth doing, in order

1. **The 10-second scroll test, BEFORE any rebuild or restart.** Does #1759 paint now in the
   running (Sep 9) client? That is the last question the current process can answer, and it
   dies on restart.
2. **Then rebuild, not just restart** (`npm run build`), or the renderer stays on Sep 9 and the
   post-restart ghost check is meaningless either way.
3. If it still does not paint on a FRESH build, it is a live bug in current source and the
   #1819 audit becomes the right map — re-run it against a reproduction rather than against
   the row.

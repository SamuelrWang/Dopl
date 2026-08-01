# NEXT-SESSION-FIXES — handoff from the live two-agent run, 2026-08-01

> **STATUS 2026-08-01 (later session): F1–F7 ALL FIXED, uncommitted on master.**
> Findings recorded as F-112 (F1 kind gate), F-113 (F2 session stamp), F-114 (F6 closed-thread
> warn), F-115 (F4 ad-hoc label) in docs/REFACTOR-FINDINGS.md; F3/F5/F7 landed without new
> findings. §3 decisions were implemented as this doc's own proposals: (1) task_* wakes only
> when addressed or thread-routed; (2) closed thread WARNS, no 403; (3) `summary` NOT split;
> (4) synthetic ids kept, rendered "ad-hoc"; (5) session STAMP (`metadata.session_id`, reserved,
> from `x-dopl-session-id`), no lock. A same-day adversarial review round (F-116) then fixed
> what the wave itself broke or overpromised: closed threads now genuinely stop PASSIVE desktop
> routing (addressed lane still delivers), the ad-hoc copy no longer tells an agent to drop the
> tag THREAD_TAG orders it to keep, team wakes carry the per-turn thread id so the scoped read
> renders, and dismissed-agent milestone notifications are rate-limited. Suites at close:
> root 1905, mcp-server 513, desktop 1853, eslint 0 errors. NOTE the §6 reserved-key list below
> is now one key stale — `session_id` was added to the strip+stamp set. Still owed: read the
> `e95bd11c` listener log (other Mac) before trusting F1 cross-account.

Written for a session with **no context of today**. Every claim below carries a `file:line`
or a `seq` number. Anything that could not be grounded is in §6, not stated as fact.

---

## 1. Read me first

### What shipped today (all committed, working tree clean)

| commit | when (local) | what |
| --- | --- | --- |
| `75faf31` | 15:16 | F-109 primitives for extended two-agent work |
| `4e1252d` | 17:30 | F-110 multiplayer — named agents, breakout rooms, THE LAW |
| `7940d97` | 17:47 | desktop **1.7.17** |
| `9b34359` | 23:17 | F-111 — group-room talk |
| `0605c93` | 23:23 | desktop **1.7.18** |
| `f56cd01` | 23:37 | live harness made adversarial |
| `d242ecc` | 08-01 01:54 | tools tell the truth about what they return (incl. the ToolSearch hint) |
| `3f41fc9` | 08-01 01:57 | desktop **1.7.19** |

Suite counts **as reported at handoff, not re-run this session**: root 1887, mcp-server 484,
desktop 1780.

### The one fact that reframes everything

**F1 is NOT "the fix is not installed."** Both machines were running 1.7.19 during the run:
the server stamps `appVersion` from the request header (`service-writes-metadata.ts:367`,
reserved and un-spoofable), and seq **#338** (owner `2dac1943`) and **#339** (owner
`e95bd11c`) — the two agent greetings at 09:04Z — both carry `"appVersion":"1.7.19"`, as do
#341, #342, #344, #346, #364. The 1.7.19 tree includes `d242ecc`, committed 08:54Z, ~10
minutes before the run opened.

**The delivery lane worked. It was never offered the messages.** Every desktop delivery lane
is gated on `kind === 'message'`:

- `main/channel-agents.js:230` — `if (!m || m.kind !== 'message') return '';` (guards the
  addressed lane, the thread lane and the engaged lane — all three sit behind it)
- `main/targeting.js:64` — `if (!m || m.kind !== 'message' || !m.authorUserId) return 'ignore';`

Meanwhile both the MCP tool description and the desktop's own spawn prompt instruct agents to
post in-thread updates as `kind="task_progress"`:

- `packages/mcp-server/src/tools/channel-description.ts:67` — *"log each concrete
  accomplishment as a milestone (kind="task_progress", thread=&lt;id&gt;) the moment it lands"*
- `dopl-desktop-app/main/prompt-framing.js:265-269` — `milestoneGuidance()` says the same
  thing to every spawned session that has a posting tool.

So the product tells the agent to use a kind the product then refuses to deliver. The
listener log (`~/Library/Application Support/dopl-desktop/listener.log`, the `2dac1943`
machine) shows the correlation is **100% predictive, in both directions, with no exception**:

```
09:06:37.821  agents: routed to flint seq 340 fed            <- kind=message
09:07:58.036  msg ... seq 345 ... verdict trigger            <- kind=message
09:08:51.743  agents: routed to flint seq 348 fed            <- kind=message
09:21:02.863  agents: routed to flint seq 358 fed            <- kind=message
09:21:04.786  agents: routed to flint seq 359 fed
09:21:04.786  agents: thread 79ce5325 delivered seq 359      <- kind=message
... and verdict `ignore` for seq 341,342,344,346,347,349,350,351,352,353,354,355,356,357,
    361,362,363,364,365 — every one of which is kind task_started/task_progress/task_finished
```

**Two findings from the run are therefore WRONG and are dropped** (see §6a): "#358 was
addressed to flint and woke nothing" (the log says `fed`), and "nothing woke a peer session"
(cobalt→flint delivered four times; flint→cobalt delivered once, at #360→#364).

---

## 2. Fix list, ranked

### P0 — F1. Every in-thread agent update is silently undeliverable

**Symptom.** After the opening exchange, nine messages queued for cobalt — including
**#349 / #351 / #352**, each carrying `metadata.to_agent_ids = ["a15e092e-…"]` — started
nothing. Both agents concluded the transport was broken (#362, #365).

**Evidence.** Every non-delivered seq is `kind` ∈ {`task_started`,`task_progress`,
`task_finished`}. Every delivered seq is `kind = "message"`. Zero counterexamples across
seq 340-368. Log lines above.

**Root cause.** `main/channel-agents.js:230` returns `''` before `engagement.addressedAgentIds`
is ever read, so the addressed / thread / engaged lanes are all unreachable for a task_* kind.
`main/targeting.js:64` then returns `ignore`, so the trigger path does not catch it either.
The kind is caller-chosen (`packages/mcp-server/src/tools/channel-schema.ts:181-192`) and both
the tool description and the desktop prompt actively recommend `task_progress`.

**Proposed fix (needs the §3 decision first).** Split the gate in two. A `task_*` post is a
*milestone*, not a turn — but a milestone that **names an agent** (`to_agent_ids` present) or
that lands **inside a thread that agent participates in** is exactly the wake the feature was
built for. Minimum change: in `routeAddressedAgent`, replace the blanket kind refusal with
"deliver `message`; deliver `task_*` only when it is ADDRESSED or thread-routed; never let
`task_started`/`task_finished` on my *own* lifecycle echo back in" — the self-echo filter
(`channel-deliver.selfEcho`) already covers the loop risk, and `myOwnAgentSpoke`
(`channel-agents.js:250`) already covers the main-room brake.

**Blast radius.** High. `task_*` volume is much larger than `message` volume, one lifecycle
echo per hop, and this reopens the auto-posture ping-pong bound documented at
`channel-agents.js:281-284`. Do not widen `targeting.classify` in the same change — that would
turn every peer milestone into a consent card.

**Verify.** `dopl-desktop-app/test/live/` — add a check that posts `kind="task_progress"` with
`to_agents=[<my other agent>]` and asserts `routeAddressedAgent` returns `'fed'` for the peer's
`myUserId`. The harness already evaluates the same real message as both machines
(`test/live/run.js:19-23`), so this needs no second Mac. `npm run test:live` from
`dopl-desktop-app/`.

---

### P1 — F2. One handle, three concurrent sessions, no wire-level session identity

**Symptom.** Two sessions posted as `flint` and issued cobalt contradictory instructions 79s
apart. Confirmed first-person from both sides (#352 inferred it, **#363** confirmed it: *"I AM
THE SECOND SESSION"*).

**Evidence.** `channel_agents` holds exactly **one** flint row —
`6979e939-1587-40b8-90c2-4c8eac291333`, owner `2dac1943`, status `active`. Three
`task_started` fired for the one request at #340, and their `client_msg_id`s carry three
distinct slot keys:

- **#341** `…:6979e939-1587-40b8-90c2-4c8eac291333#…` → ROOM slot `(channel, agent)`
- **#344** `…79ce5325-f53e-4d00-a1c0-f48875000bc0#…` → PAIR slot `(channel, thread)`
- **#346** `…task-dba90694-…-345#…` → PAIR slot on a synthetic legacy thread

**Root cause, two layers.**
1. **Slot keys are disjoint by design.** `main/session-store.js:50-54` — `slotKey` uses
   `agentId` when present, else `taskId`. A ROOM session and a PAIR session therefore never
   collide, and `session-team.js:34` ("THE SLOT IS (channel, agent)") is true only *within* the
   room key space. Three sessions on one machine is the documented behavior, not a race.
2. **`as_agent` is per-CALL and ownership-checked only.** The server validates that the caller
   *owns* the claimed agent (`service-writes-metadata.ts:371-373`, `authorAgentId` → 403 if not
   owned) — it never checks which session is calling. Any process holding the operator's
   credential can post as any agent that operator owns. **There is nothing on the wire that
   identifies a session**, so `"flint said X"` is not a well-formed statement.

**Proposed fix.** Prefer the stamp over the lock. Add a server-stamped `session_id` to
`metadata` on the same reserved-key discipline as `runtime`/`appVersion`
(`service-writes-metadata.ts:363-367`) — sourced from the desktop's slot key, stripped from
caller metadata — and render it in `read`/`await` lines. Enforcing one live session per agent
id is the *wrong* first move: it would break the legitimate three-slot design and does nothing
for an external CLI session that passes `as_agent`.

**Blast radius.** Additive if the render is a suffix. A migration is not needed (jsonb).

**Verify.** Harness check: two sessions posting `as_agent` the same handle must produce two
distinct `metadata.session_id` values; a caller-supplied `session_id` must be stripped.

---

### P1 — F6. A closed thread still accepts posts, silently

**Symptom.** flint closed thread `79ce5325` at **#355** (`task_finished`), then posted **#356,
#361, #362, #363, #365** into it. No refusal, no warning.

**Root cause.** The post path resolves the thread and gates on *membership*, never on
*status*. `src/features/channels/server/service-writes-metadata.ts:414-421`:

```ts
task = await repoTasks.findTaskByChannelAndId(channel.id, callerTaskId);
if (!task) throw new ChannelTaskNotInChannelError(callerTaskId);
if (!(await mayWriteThread(task, ctx.userId, agents.authorAgentId))) {
  throw new TaskForbiddenError("post into this task");
}
```

`status` / `closed_at` are written on close (`service-tasks.ts:357`) and cleared on reopen
(`service-tasks.ts:441`) but read nowhere on the write path. The MCP close result reads
*"Closed thread **&lt;title&gt;** … as &lt;outcome&gt;"* (`channel-ops-threads.ts:330`) — finality the
server does not enforce.

**Proposed fix.** WARN, do not refuse (see §3). Return the post with a note — *"this thread is
closed; reopen it or open a new one"* — and make the close result say the thread stops routing
rather than stops accepting. A hard 403 would break the legitimate "one last word after the
close echo" pattern and would land on `reopen`, which has no MCP counterpart
(`schema.ts:296-305`).

**Verify.** Server unit test on `resolvePostMetadata` + a harness check that close→post
returns the warning string.

---

### P2 — F3. An agent reported having no dopl tools, in a message sent with those tools

**Symptom.** **#345**, verbatim: *"CONFIRMED: I do not have the mcp__dopl__dopl_channel tool
(or any dopl_* tool) available in my actual toolset for this session."* The post landed.

**Was the fix live? YES, and it was insufficient.** `d242ecc` (08:54Z) added `TOOL_LOOKUP` at
`main/prompt-framing.js:171-176`, appended to **every** delivery branch (`:202, :210, :218,
:226`). 1.7.19 includes it; cobalt's session started 09:06:52 (#342). The agent still reported
the tool as absent 64 seconds later.

**Root cause.** Claude Code defers MCP schemas; the tool is a name in a system-reminder until
`ToolSearch` loads it. The current text is a **conditional aside inside the DELIVERY section**
— "If … is not in your tool list yet" — which an agent that has already concluded "not in my
list" reads as confirmation rather than as an instruction.

**Proposed fix.** Move it earlier and make it imperative and unconditional: *"Your FIRST action
this turn is `ToolSearch("select:mcp__dopl__dopl_channel")`. Do not report the tool missing —
it is deferred, not absent."* Keep it once (the file's own rule at `:165-170`).

**Blast radius.** Prompt text only. Costs one tool call per spawn.

**Verify.** Not automatable. Re-run the two-agent protocol (§4) and check no agent self-reports
a missing tool.

---

### P2 — F7. ASSIST responder gets ZERO thread history

**Symptom.** Thread `5137457e`: #360 posted, #364 `task_started`, #366 correct reply. The
responder reported it could see **0 prior messages** of the thread it was replying into.

**Root cause.** The channel-history seed is only wired for a **recreated/reopened** shell.
`main/session-engine.js:59` — `loadHistory: sessionHistory.load, // D3: a recreated shell
paints the channel history` — and its only call sites are `main/session-park.js:193` and
`:233`. A fresh responder spawn never calls it. `main/session-seed.js:64-66` says as much:
*"A reopened shell with no resumable sdk session starts a FRESH run, so its first turn carries
the fetched thread as CONTEXT."*

**Proposed fix.** `read thread=<id>` now exists and FILTERS to one exchange
(`channel-schema.ts:220-225`), so seeding a fresh responder is one scoped call. Either call
`sessionHistory.load` on the responder spawn path too (reusing `frameHistorySeed`, `SEED_CAP`
4000 at `session-seed.js:98`), or add one line to the prompt telling it to run
`read thread=<id>` first. The prompt line is cheaper and keeps the fence discipline intact.

### The latency half of F7 is MISATTRIBUTED — do not chase the trigger

Claimed: 5m17s pickup, "trigger is not prompt". The DB and log say the transport is fast and a
**human** was the delay:

| hop | measured |
| --- | --- |
| #360 written → flint's listener saw it | 09:22:01.220Z → 09:22:02.834Z = **1.6s** |
| #345 written → consent row created | 09:07:56.920Z → 09:07:58.036Z = **1.1s** |
| consent created → #346 `task_started` (accept + spawn) | 09:07:58.036 → 09:08:10.861 = **12.8s** |
| #360 → #364 `task_started` (cobalt's machine) | 09:22:01.220 → 09:26:54.477 = **4m53s** |

Same machinery, ~14s end-to-end when the operator clicks. The 4m53s is a consent card sitting
unclicked on the other Mac. (The run reported "posted 09:21:37" — the DB row is 09:22:01;
09:21:37 is the client's call time, not the write.) Poll constants for reference:
`main/config.js:57-73` — `AWAIT_TIMEOUT_MS 50_000`, `IDLE_GAP_MS 400`, realtime push replaces
the hold when healthy. **Nothing here needs tuning.**

---

### P3 — F4. A keyless post manufactures a synthetic thread on the receiving side

**Symptom.** cobalt posted #345 with no `thread=`. flint's machine created
`task-dba90694-de4f-4950-83a9-f2d890c9ff3f-345` — named after the **sender's** seq.

**Evidence.** Exactly 2 messages carry that tag (#346, #368). It is one of **31** such
synthetic tags in this channel (`select metadata->>'taskId' … like 'task-%'` — the run's "24"
is stale).

**Root cause.** The legacy id is deterministic from `(channel, seq)`:
`main/trigger.js:69` `taskIdFor(rec)`, mirrored byte-for-byte at
`main/legacy-threads.js:143`. Server-side these ids are second-class on purpose —
`service-writes-metadata.ts:422-431` strips a legacy tag that is not the poster's own exchange
rather than refusing it, and `channel-agents.js:282-284` refuses to let a legacy id select the
thread lane at all (`targeting.firstClassTaskId` is UUID-gated).

**Assessment: leave the mechanism, fix the label.** It is doing its job — it groups an untagged
request with its reply on the requester's card. It is not a thread and it must never become
one. What is wrong is that it is *indistinguishable* from a real thread id in the UI and in
`read` output. Render it as "ad-hoc" / "untagged exchange", not as a thread. Do not "stop" it:
that would strand every untagged request.

---

### P3 — F5. MCP schema vs server caps — mostly deliberate, one real gap

The run's claim ("the contract is wrong, 10x") is **overstated**. The 200/2000 split is
explicitly designed and commented at `packages/mcp-server/src/tools/channel-schema.ts:168-172`:
one `summary` param serves two routes with two caps, so the schema declares the **looser** one
to avoid refusing a legitimate `close_thread` summary client-side. The `.describe()` at `:179`
already says *"<=200 chars — the post route enforces 200, not 2000"*.

Full field audit:

| field | MCP schema (`channel-schema.ts`) | server post (`schema.ts:236-250`) | server create_thread (`:274-278`) | server close (`:301`) | verdict |
| --- | --- | --- | --- | --- | --- |
| `body` | `.max(16000)`, no min | `.min(1).max(16000)` | `.min(1).max(16000)` | — | **gap**: empty body → server 400, not -32602 |
| `summary` | `.trim().max(2000)` | `.trim().min(1).max(200)` | — | `.trim().max(2000)` | by design; prose-only 200 |
| `client_msg_id` | `.max(200)`, no min | `.min(1).max(200)` | `.min(1).max(200)` | — | **the good path** (200/200) — this is what the fix looks like |
| `title` | `.trim().max(200)`, no min | — | `.trim().min(1).max(200)` | — | **gap**: empty title → server 400 |
| `to_agent` | `z.string()`, **no max** | `.trim().min(1).max(64)` | — | — | **real gap**: >64-char handle → opaque 400 |
| `to_agents` | `.array(z.string()).min(1).max(8)` | items `.max(64)`, `.min(1).max(8)` | — | — | **real gap**: per-item 64 unpublished |
| `participants` | `.array().max(20)` | — | `ThreadParticipantSeedSchema` | — | ok |
| `limit` / `since` / `timeout_ms` | coerced, bounded | matches | — | — | ok |

**Fix.** Add `.min(1)` to `body`/`client_msg_id`/`title` and `.max(64)` to `to_agent` /
`to_agents` items in the MCP schema. Leave `summary` alone — but consider making the *machine
readable* half honest by splitting it into `summary` (200) and letting `close_thread` take its
own param, since a model obeys `maxLength`, not prose. That is a §3 decision, not a bug fix.

---

## 3. Open product decisions — the next session must NOT decide these alone

1. **Should a `task_*` post wake a peer session?** (F1) It is the difference between "the
   milestone stream is chatter" and "the milestone stream is the conversation". Everything else
   in F1 follows from this answer. The current code says no; the current *prompts* say yes.
2. **Closed thread: refuse, warn, or document?** (F6) A refusal is a breaking change for any
   agent that posts a final word after the close echo.
3. **Should `summary` be split into two MCP params?** (F5) Correct contract vs. one more param
   in an already-large tool.
4. **Should a synthetic `task-<channel>-<seq>` id be visible to agents at all?** (F4) Hiding it
   is honest but removes the only grouping an untagged exchange has.
5. **Is one-live-session-per-agent-id a goal, or is multi-session with a stamp the model?** (F2)
   This decides whether §2's F2 fix is a lock or a label.

---

## 4. How to test

**The harness.** `dopl-desktop-app/test/live/` — `npm run test:live` from `dopl-desktop-app/`.
It posts real messages through the real API and feeds each returned message through the **real
desktop decision modules twice, once as the sender's machine and once as the peer's**
(`test/live/run.js:8-23`). Two agents owned by the same caller in a throwaway
`harness-<stamp>` channel is enough to exercise addressing, multi-address, threading, the
handshake and delivery. **No credential → clean skip, exit 0.** It refuses the operator's real
DM (`FORBIDDEN_CHANNEL_IDS`) and deletes its own channel.

**This is the right vehicle for every fix above.** A single harness check on
`routeAddressedAgent(entry, {kind:'task_progress', to_agent_ids:[…]}, peerId)` would have
caught F1 in one second, without a second Mac.

**The two-agent live protocol.** Summon one agent per machine, address both from a human
message, and have them run probes rather than describe them. Then **verify their findings
independently** — see §5.

**Warning, learned today.** A live run's own findings need independent verification. At
#329-#337 the two agents *jointly escalated a `dopl_map` bug that does not exist*, then
withdrew it (#333: *"Hold the escalation. There is no `dopl_map` bug"*). Two agents sharing a
blind spot produce agreement, not evidence. Three of today's headline claims were wrong (§6a).

---

## 5. Traps

- **The `dopl_channel` tool FILTERS. Use Supabase directly for forensics.** `op="read"`
  applies a thread filter, a kind filter and a 100-message default window
  (`channel-schema.ts:240-248`). This channel is
  `dba90694-de4f-4950-83a9-f2d890c9ff3f`; query `channel_messages` with
  `mcp__supabase__execute_sql`. Note the column is `author_user_id` — the agent id lives in
  `metadata->>'author_agent_id'`, there is no `author_agent_id` column.
- **`dopl_map` is a curated view, not the workspace.** Per-resource public/private flags and a
  draft filter mean two callers legitimately see different counts. It is not a bug. See #333.
- **Agent identity is NOT 1:1 with session.** One `channel_agents` row can be claimed by any
  number of concurrent processes holding the owner's credential (§2 F2). "flint said X" needs a
  session id before it means anything.
- **The listener log is per-machine and is the only place verdicts are visible.**
  `~/Library/Application Support/dopl-desktop/listener.log`. The `2dac1943` machine's log is on
  this Mac; the `e95bd11c` half is on the other one and was **not** available for this analysis.
- **A green suite has missed every seam bug today.** 4151 passing tests did not catch a kind
  gate that makes the headline feature undeliverable, because every unit test constructs
  `kind: "message"`. Grep the desktop tests for `kind:` and you will find almost nothing else.
- **`_dopl_status` `runtime=` is a routing hint, not an authorization.** `appVersion` and
  `runtime` are server-stamped from the request header and are reserved
  (`service-writes-metadata.ts:363-367`) — those two you can trust for forensics.

---

## 6. Carried forward (each re-verified today)

- **`to_user_notify` is reserved in docs, unbuilt, and NOT in the strip list.** Confirmed:
  `service-writes-metadata.ts:399-402` deletes only `taskMode`/`taskCreatedBy`/`taskTitle`/
  `taskTarget`; the re-stamped set is `intent`, `runtime`, `appVersion`, `author_agent_id`,
  `to_agent_ids`, `to_agent_id`, `to_user_id`, `summary` + the calm flags. `to_user_notify` is
  in none of them. Spoofable the day a consumer ships — the strip must land in the SAME change
  (`docs/REFACTOR-FINDINGS.md:776`, `docs/ENGINEERING.md:448`).
- **Slug-form handshake key seeds 0 participants for a raw API caller.** Confirmed:
  `service-thread-handshake.ts:161-166` — `parseHandshakeSeq(clientMsgId, channelId)` is
  channel-**id** anchored, returns `null` for a slug-built key, and
  `deriveHandshakeParticipants` returns `[]`. The MCP lane normalizes and says so
  (`channel-description.ts:67`); REST callers are not rescued.
- **`op="await"` returns nothing in a single-operator room** because `excludeAuthor` filters
  the caller's own account and both agents run on one device token. *(Not re-derived from code
  this session — carried on the prior session's word.)*
- **Team sessions can never receive the operator's armed posture.** Confirmed:
  `session-engine.js:251` — `const startModes = spec.startModes && !spec.parkedShell ? … : {}`
  — and `session-team.js:185` always sets `parkedShell: true`. Plus `channel-prefs.js:152` is
  SINGLE USE and channel-keyed, so with N agents the first launch eats the arm. This is the
  user-visible "bypass/auto is not enforced" complaint and it has two independent causes; fix
  both or neither.
- **Flaky test / source-probe debt (F-108).** Confirmed:
  `dopl-desktop-app/test/tray-update-ready.test.mjs:22-32` reads `main/index.js` with
  `readFileSync` as its subject and can see a TRUNCATED file under parallel `node --test`.
- **`GET /api/skills` always reports `connectors: []`.** Confirmed:
  `src/features/skills/server/dto.ts:108` — `mapSkillSummaryRow` hardcodes
  `{ ...row, connectors: [] }`.
- **Still open, not re-verified this session:** skill-KB references report availability by
  existence not access; chat retention asymmetry (read refuses what write allows); RLS is dead
  weight on every traced path (all `supabaseAdmin()`), so team scoping exists only in
  TypeScript.

### 6a. WRONG or already fixed — dropped, do not re-investigate

1. **"Nothing woke a peer session."** False. #345 → `verdict trigger` → #346 spawn; #348, #358,
   #359 → `agents: routed to flint … fed`; #360 → #364 spawn on cobalt's machine. Delivery
   worked five times. The real defect is the kind gate (F1).
2. **"#358 was addressed to flint and woke nothing."** False. `listener.log` 09:21:02.863:
   `agents: routed to flint seq 358 fed`.
3. **"The machines may not have been running 1.7.19."** False. `appVersion:"1.7.19"` on #338,
   #339, #341, #342, #344, #346, #364 — server-stamped, both owners.
4. **"F3's fix may not have been live."** It was live (`d242ecc` 08:54Z, in 1.7.19,
   `prompt-framing.js:171-176`, appended to all four branches). It is **insufficient**, which
   is a different and more useful finding.
5. **"F5: the contract is wrong by 10x."** Overstated. The split is deliberate and commented
   (`channel-schema.ts:168-172`) and the 200 is already in the `.describe()`. The real gaps are
   the missing `.min(1)`s and the unpublished 64-char agent-ref cap.
6. **"F7: pickup took 5m17s, the trigger is not prompt."** Misattributed. Transport is ~1.6s;
   consent creation ~1.1s; accept-and-spawn ~13s. The 4m53s was a human not clicking a consent
   card. Do not tune the listener.
7. **"24 synthetic thread tags."** Stale count. There are **31**.
8. **The `dopl_map` bug (#329-#333).** Withdrawn by its own authors. Two visibility systems
   (per-resource public/private + a draft filter), working as designed. `access_matrix`
   conflating scope-mode with visibility is the one genuine finding and it is a docs issue.

### 6b. Unverified, needs investigation

- **Which of the two flint sessions authored which seq.** The three spawn slots are proven from
  `client_msg_id` (#341/#344/#346) and #363 is a first-person confession, but `metadata` alone
  cannot attribute #349/#350 vs #351-#356 — that is exactly the gap F2's session stamp closes.
- **Why cobalt's machine did not spawn for #349/#351/#352 beyond the kind gate.** The kind gate
  fully explains it and is sufficient, but the `e95bd11c` listener log was not available to
  confirm the verdict logged there. Read that log before shipping the F1 fix.
- **Whether `op="await"`'s `excludeAuthor` still behaves as previously reported.** Carried
  forward on the prior session's word only.

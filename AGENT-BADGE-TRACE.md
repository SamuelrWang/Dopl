# AGENT-BADGE-TRACE — "agent ended" posts whose badge reads just "Agent"

Investigation only. No code changed. 2026-09-15, tracing Samuel's report: messages saying a
session ended, wearing a bare **Agent** badge with no name or handle, appearing at seemingly
random times.

---

## 0. Answer in three lines

1. **They are real Dopl posts, written by your own desktop's MAIN PROCESS** (not by any agent,
   and nothing to do with Claude Desktop). Three writers only: the session-end lifecycle note,
   the windowless tool-denial counter, and the queued notice.
2. **They carry no agent identity because the main process posts them over a different HTTP
   path than an agent does** — `dopl-desktop-app/main/listener-io.js › sendOnce` sends no
   `X-Dopl-Session-Id` header, and `channel-post.js › postTaskEvent` mints a `client_msg_id`
   that is deliberately not stamp-shaped. Both of the two doors that say *which agent wrote
   this* are therefore shut, and every renderer honestly answers "cannot say" → `Agent`.
3. **"Random" is not random**: `Session ended` is posted only for `reason === 'operator'`, and
   an operator-end is dispatched by SIX different callers, four of which are not you clicking
   anything — an orchestrator agent ending a worker over MCP, an agent-card delete, a quit, and
   the park-on-claim sweep when a person joins a container your agent was working in.

---

## 1. Specimen evidence (channel `bb0f57db-…`)

Read back over MCP, the specimens differ from every other agent row in exactly one clause:

```
#1732  agent @agent-`z9imv68v` for `Samuel Wang` (`2dac1943-…`) · session `z9imv68v` · → @`Prime`
#1733  agent                   for `Samuel Wang` (`2dac1943-…`) · task_progress · → nobody · none?
#1734  agent                   for `Samuel Wang` (`2dac1943-…`) · task_progress · → nobody · none?
#1735  agent                   for `Samuel Wang` (`2dac1943-…`) · task_progress · → nobody · none?
#1718  agent                   for `Samuel Wang` (`2dac1943-…`) · task_progress · → nobody · none?
       "denied mcp__dopl__dopl_channel (tool mode bypass); further denials counted"
#1724  agent                   for `Samuel Wang` (`2dac1943-…`) · task_progress · "Session ended"
```

The `· session <id>` clause is **absent** on #1718, #1724, #1733–#1735 and present on every
agent-authored message row. That clause is rendered straight off `metadata.session_id`
(`packages/mcp-server/src/tools/channel-render.ts:176`, `channel-render-identity.ts:93`), so the
DB row for each specimen has:

| field | specimens | ordinary agent post |
|---|---|---|
| `author_kind` | `agent` | `agent` |
| `author_user_id` | Samuel's uuid | Samuel's uuid |
| `kind` | `task_progress` | `message` |
| `client_msg_id` | `task_progress-<channelUUID>-<seq>` / `denied-<channelUUID>-<sessionId>` | `agent-<agentId>-<seq>` or the agent's own key |
| `metadata.session_id` | **absent** | `<channelId>:<taskId>:<agentId>` |
| `metadata.appVersion` | present | present |
| `recipient_*` | `[]` → "nobody" | resolved |

Timing corroborates the trigger claim: #1733/#1734/#1735 land at `18:54:08.149`, `.366`, `.382`
— 0.23 s apart, i.e. one loop ending three sessions, which is #1736 (Prime reporting "I've ended
their sessions"), not three independent events.

---

## 2. Root cause: identity is never put on the row at WRITE time

### 2.1 The two doors, and why both are shut

`src/features/channels/lib/agent-post-stamp.ts:92-100 › authorAgentIdOf` is the single answer to
"which agent wrote this row". It tries exactly two things:

* **Door A — the post stamp.** `parseAgentPostStamp` (`agent-post-stamp.ts:19`) matches
  `^agent-([a-z][a-z0-9]{7})-\d+$` against `client_msg_id`.
  `dopl-desktop-app/main/channel-post.js:60` writes
  `` `${kind}-${entry.channel.id}-${m.seq}` `` → `task_progress-bb0f57db-…-1234`. No match —
  and the anchoring is deliberate so a channel UUID can never be read as an agent id.
  `session-windowless.js:255` writes `denied-<channelId>-<sessionId>`. No match either.
* **Door B — the server's session stamp.** `metadata.session_id` is stripped from caller input
  unconditionally (`src/features/channels/server/service-writes-metadata.ts:282`) and re-stamped
  ONLY from the `X-Dopl-Session-Id` request header (`:320`, fold 6b; header contract in
  `src/shared/auth/session-header.ts:21-39`).
  **`dopl-desktop-app/main/listener-io.js:218-221` builds the header set for every main-process
  call and has no session header at all** — only `Accept`, app-version, `Cookie`,
  `X-Workspace-Id`, `Content-Type`.

A spawned agent's own posts get door B for free: `runtime/claude/launch-spec.js:159` calls
`loader.js:250 › withSessionStamp(options.mcpServers, store.slotKey(s))`, which pins
`X-Dopl-Session-Id` onto the MCP server entry for that run. **The main process never went
through that seam**, so its posts are anonymous by construction.

### 2.2 Consequence, downstream, is uniform and correct

Nothing is "dropped at render" — every reader is faithfully reporting UNKNOWN:

* `src/features/channels/server/dto.ts:146-156 › agentNameOf` → `authorAgentIdOf` = `null` →
  `authorAgentName: null` (`dto.ts:187`). The `channel_sessions.display_name` join
  (`service-shared.ts:312 › agentNamesFor`) is never even attempted for these rows.
* MCP read: `packages/mcp-server/src/tools/channel-render-identity.ts:73-79 › agentHandleOf`
  returns `null` (no name, no session tail) → `formatAuthor` (`:44-48`) emits
  `agent for \`Samuel Wang\` (\`…\`)`. **This is the exact specimen string.**
* Web transcript: `task_progress` is NOT a lifecycle kind
  (`src/features/channels/components/view-model-rows.ts:53-59` — deliberately excludes it), so
  the row renders as an ordinary message bubble via `toMessageRow` (`:287-336`) with
  `agent: true, agentId: null`, then
  `src/features/channels/components/attribution-pill.tsx:109`:
  `return agentId ? \`#${agentId}\` : "Agent";`
  **That line is the bare "Agent" badge Samuel sees.** It is the honest fallback
  (INVARIANTS §11), not a bug in itself.

### 2.3 Why it looks like "not a Dopl agent"

The pill also drops the *openable* affordance — `attribution-pill.tsx:182`
(`openable = agent && agentId !== null && onOpenAgent !== undefined`) — so the badge neither
names an agent nor opens one. Combined with `→ nobody`, the row reads as authored by nothing.
It is in fact authored by Samuel's account, `author_kind='agent'`, written by his own Electron
main process.

This is the concrete face of the known open issue "session_id + appVersion lack forensic join":
these rows carry `appVersion` and no `session_id`, so there is no key at all to join an ended
session to the agent that ended.

---

## 3. Every writer of these posts (complete)

All three go through `dopl-desktop-app/main/channel-post.js:48 › postTaskEvent`, kind
`task_progress`, and all three are affected identically.

| # | writer | body | file:line |
|---|---|---|---|
| W1 | session lifecycle echo | `Session ended` / `This session went inactive.` | `main/trigger-outcomes.js:179-196` (body chosen at `:193`) |
| W2 | windowless tool-denial counter | `denied <tool> (<reason>); further denials counted` | `main/session-windowless.js:243-259` |
| W3 | queued notice | `QUEUED_BODY` | `main/queued-notice.js:83` |

W1's wording comes from `main/session-effects.js:144-152 › endLifecycle`:

* `reason === 'operator'` → **`Session ended`**
* `reason === 'abandoned' | 'inactive'` → `This session went inactive.` (`INACTIVE_NOTE`,
  `session-effects.js:92`)
* anything else → `null`, nothing posted.

⚠ A **crash posts nothing to the channel**: the crash arm emits `task_failed`
(`main/session-reducer.js:474-483`) and `trigger-outcomes.js:185` drops every kind that is not
`task_progress`. The boot reaper (`main/session-boot.js:259-292`) likewise writes only a LOCAL
history entry. So no "crash reaper" produces these rows.

### 3.1 What actually triggers `Session ended` — the "random" list

`Session ended` requires `reason === 'operator'`, which is the reducer's `{type:'end'}`
(`main/session-reducer.js:365-366`). Six dispatchers reach it:

| trigger | Samuel-caused? | file:line |
|---|---|---|
| T1 Agents-tab / window **End** button | yes | `main/session-ipc-ops.js:353` (`sessions:end`) |
| T2 **Deleting** an agent card | yes | `main/session-delete-op.js:77` |
| T3 **Another agent ends it over MCP** (`dopl_agents end_agent`, orchestrator directive) | **no** | `main/directive-agent-ops.js:135` → `controlByTask({action:'end'})` |
| T4 In-session `end_agent` tool (an agent ending a sibling) | **no** | `runtime/claude/axis-b.js › makeAgentOpsServer` → same `controlByTask` |
| T5 **Park-on-claim**: a person joins a container one of your sessions was working in → that session is ended | **no** | `main/session-park-on-claim.js:134-137` |
| T6 `controlByTask` from the reopen surface | mixed | `main/session-reopen.js:202` (`CONTROL_EVENTS.end`) |

**T3/T4 is what produced #1724 and #1733–#1735** (Prime ending its three workers — see #1736).
**T5 is the best candidate for the ones Samuel never caused**: it fires off the reconcile pass,
minutes after an unrelated membership change, with no click anywhere.

And `This session went inactive.` has four producers, all clockwork rather than intent:

| trigger | file:line |
|---|---|
| T7 launch watchdog — no `system/init` within `LAUNCHING_MS` | `main/session-state.js:222` → reducer `:454` |
| T8 abandonment — parked longer than `ABANDONED_MS` (12 h) | `main/session-state.js:223-224` → reducer `:406-416` |
| T9 app **quit** — every live session ended | `main/session-reopen.js:487-491` |
| T10 **auth hold** — a park, which still posts the ended note once | reducer `:418-437` → `session-effects.js:252` |

T7–T10 are the second half of "appears at random": T8 fires half a day later, T10 fires when a
credential lapses, and neither names the agent it was about.

---

## 4. Fix proposal

**Stamp identity at WRITE. Do not patch the render.** The renderers are correct: `null` means
cannot-say and must keep printing `Agent`. What is wrong is that a post written on behalf of a
known session arrives with the session erased.

### Fix A (primary, small, no schema change)

1. `dopl-desktop-app/main/listener-io.js:200-222` — accept `opts.sessionId` in `sendOnce` and set
   `headers['X-Dopl-Session-Id'] = sessionId` when it matches the existing shape check already
   spelled at `runtime/claude/loader.js:249` (`/^[A-Za-z0-9:._-]{1,128}$/`). Reuse that constant
   rather than minting a third copy.
2. `dopl-desktop-app/main/channel-post.js:48-76` — thread `opts.sessionId` through `postTaskEvent`
   into the `apiFetch` call.
3. Call sites, all of which already hold the slot key:
   * `main/trigger-outcomes.js:186` — `echoTargets(info)` is handed `info.key` by
     `main/session-engine-host.js:41 › runLifecycle`; carry it through (`:122-128`).
   * `main/session-windowless.js:248` — `s.key` (or `store.slotKey(s)`).
   * `main/queued-notice.js:83` — same.

The server then stamps `metadata.session_id` at `service-writes-metadata.ts:320`, and everything
downstream repairs itself with no further change: `authorAgentIdOf` finds the tail,
`agentNamesFor` joins `channel_sessions.display_name`, the MCP line becomes
`agent @coder-for-x for \`Samuel Wang\``, and the web pill shows the rename or `#z9imv68v` and
becomes clickable.

⚠ Deliberately NOT proposed: changing the `client_msg_id` to the stamp shape. Those ids are
idempotency keys with per-writer semantics (`queued-notice` keys on the thread,
`session-windowless` on the session) and re-shaping them would break the dedupe bounds those
files are built around.

### Fix B (secondary, optional, copy-only)

With A in place these rows still say `Session ended` with no subject. If Samuel wants the row to
NAME the agent in its body, that is `main/session-effects.js:144-152` — but note the standing
ruling of 2026-09-13 ("we can just put 'ended', we don't need to give a reason why"), so the
handle belongs in the BADGE (Fix A), not back in the sentence.

### Fix C (not recommended)

Rendering `task_progress` as a receipt row instead of a message bubble
(`view-model-rows.ts:53-59`) would remove the misleading author pill entirely. Rejected: the
docblock there records that the calm `session_ended` note's body is real prose a peer needs, and
receipts drop the body. Revisit only if Samuel wants these rows out of the transcript flow.

---

## 4b. WHAT WAS APPLIED (2026-09-15, after Samuel's go on all three items)

Investigation above is unchanged and is what the fix was built from. Shipped:

**Fix A — identity stamped at write.** `main/session-id-header.js` is new and holds the rule
(`app-version.js`'s idiom: a `HEADER`, a shape `SESSION_ID_RE` mirroring the server's, and a
`sessionHeaders(slotKey)` that answers `{}` or one header). `listener-io.js › sendOnce` spreads
it onto every request; `channel-post.js › postTaskEvent` takes `opts.sessionId`. Two writers pass
the slot key — the lifecycle echo (`trigger-outcomes.js › echoTargets`, `i.key` and NOT the
ephemeral `i.sessionId`) and the denial counter (`session-windowless.js`, `s.key`).

⚠ **The queued notice deliberately stamps nothing.** It is a post about the MACHINE on the busy
path, where no session of its own exists; attributing it to whichever session held the slot would
name an agent that is not its subject. That row still renders "Agent", and that is now the only
remaining case — which is correct rather than residual.

**Park-on-claim says why.** A caller may NAME an end: `session-effects.js › endReasonOf` holds
the closed set (`claimed`) and the fallback, `session-park-on-claim.js` passes it, and
`session-reopen.js › controlByTask` forwards it without policing (one vocabulary, one validator).
Peer reads "Session ended because a person joined this channel."; the operator's own window reads
"Ended because a person joined this channel". An unknown reason falls back to the operator's End
wording, never to silence.

**Auth hold stops claiming "went inactive".** It now posts `AUTH_HELD_NOTE` — "This session is
paused: the agent sign-in on this machine needs attention." ⚠ **It still POSTS**, and that half
is deliberate: deleting the note reinstates the exact C-5 defect on this path (a preflight hold
runs no query, so nothing reaches the wire and the requester's card pulses over a machine nobody
has signed in on). What changed is the claim, not the courtesy. Flagged for Samuel in case he
meant deletion outright — that is a one-line follow-up.

Tests: `dopl-desktop-app/test/session-id-header.test.mjs` (new), plus cases added to
`lifecycle-echo`, `session-inactive-notice`, `listener-auth-repair`. Two existing pins were
REWRITTEN rather than deleted, each recording the overruled ruling in place:
`session-inactive-notice.test.mjs` (auth-hold wording) and `app-version-header.test.mjs` (its
headers pin required the literal to close right after `versionHeaders()`, which asserted the
absence of every other seam stamp as a side effect).

⚠ Three desktop files sat within 1-6 lines of the §2 500-line cap, which is why the stamp became
its own module and the reason vocabulary moved into the pure block rather than living at the call
sites. All of `main/` and `test/` lint clean.

---

## 5. Open, for Samuel's ruling

* **Q1** — Apply Fix A? It is the only change that makes an ended-session row attributable, and
  it closes the `session_id` half of the known "no forensic join" gap.
* **Q2** — T5 (park-on-claim) ends live sessions with no confirmation and the resulting post
  names neither the agent nor the reason. Worth a louder local notice, or a body that says
  "ended because a person joined this channel"? Currently it is indistinguishable from T1.
* **Q3** — T10 (auth hold) posts "went inactive" for a session that is PARKED, not ended. That is
  peer-facing copy for a state that can still resume. Intentional?

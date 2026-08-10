# Channels Audit — 2026-08-07

**Method:** four independent read-only Opus agents against the current working tree (`master`, post-retirement edits): spec-vs-code, thread/session lifecycle, permissions/multi-party, client wiring/races. Nothing was modified. Findings below are **deduplicated** — several were reached independently from two or three angles, which is noted where it happened (independent confirmation = higher confidence).

**Overall:** the overhaul is structurally sound. Every superseded-rule sweep came back clean — no named-agent, engagement, participant-set, breakout or `@mention` code survives; `create_thread` atomicity, the reserved-key strip, thread-participation gating, the `await` security invariant, the advisory-lock insert RPC, and consent's CAS + DB-dedupe are all correct as specified. Both suites are green (2379 desktop, full web suite).

**But:** none of the WOULD-NOT-WORK findings below has a test, and two are *asserted as correct* by a test on one side of a boundary the other side violates. The failures cluster in four places: (1) the desktop↔server session-state contract, (2) terminal states that post nothing, (3) delete/close/reopen semantics, (4) agent containment defaults.

---

## Tier 1 — Would not work / silent data loss

### C-1. The stale-threads cron sweeps **live** threads — ✅ RESOLVED (2026-08-08, F-171), and it was NOT marked here until this pass
*The route was rewritten. The clock now derives activity from `channel_messages` at READ time via a `channel_tasks_stale` RPC + one index, rather than from `channel_tasks.updated_at` — chosen over a trigger or a `postMessage` touch because it is O(open threads) read once a day instead of O(messages) written forever, and because it leaves `updated_at` with ONE honest meaning (which also kills the `set_thread_mode`-resets-the-clock half with no further code). C-17's NULL-author insert went with it. ⚠ **The job has still never executed** — `CRON_SECRET` is unset — so **shipping this turns the sweep on for the first time, against a 14-day backlog.** That is the item in "Questions for you", and it is a launch decision, not a code one.*

`src/app/api/cron/stale-threads/route.ts:88-94` filters on `channel_tasks.updated_at`, and its own docblock (`:57-59`) claims this measures last activity. It doesn't: the only writer to that column is `updateTask` (`repository-tasks.ts:97-110`), reached solely from close / set_mode / reopen. `postMessage` bumps `channels.updated_at`, never the task row, and the migration has no trigger. So `updated_at == created_at` for any thread that was never closed.

**Effect:** a 15-day-old thread with hourly traffic gets a system card saying "no activity for a while." Conversely `set_thread_mode` resets the clock with zero activity. Currently inert — `CRON_SECRET` is unset in Vercel — which also means shipping a fix turns this on for the first time against a 14-day backlog.

### C-2. One ad-hoc session poisons the entire workspace's session-state push
Server contract: `SESSION_KEY_RE = /^[0-9a-fA-F-]{1,64}:[0-9a-fA-F-]{0,64}$/`, `threadId: z.string().uuid()` (`src/features/channels/schema-sessions.ts:44,72`), pinned by `schema-sessions.test.ts:87`. Producer violates it: an unthreaded inbound (the ordinary DM) yields `` `task-${channelId}-${seq}` `` (`dopl-desktop-app/main/targeting.js:257-260` → `trigger.js:68` → `session-spawner.js:224`), verified non-matching (`t`,`s`,`k` aren't hex).

**Effect:** one bad element fails the whole `sessions` array; 400 is non-retryable and the digest isn't recorded, so every later push fails too. While any ad-hoc session is live, `read_sessions` returns `[]` for that machine — *including valid UUID-threaded sessions in the same array* — and stale rows are never cleared. Neither suite crosses the boundary; the desktop's own fixture (`test/session-state-push.test.mjs:50`) would also be rejected by the server.

### C-3. The channel listener advances its **persisted** cursor before dispatching
`dopl-desktop-app/main/channel-listener.js:152-157` — `io.setCursor` (electron-store) runs before `dispatchMessage`. Every downstream early return is then a permanent silent drop: no Claude runtime (`trigger.js:106-109`), or `!created`, which is `null` on *any* network error or non-2xx from the consent POST (`consent.js:113-123`).

**Effect:** wifi drops for 15s during the consent POST → no consent row, nothing in Pending Requests, cursor already past the seq, restart re-awaits from the advanced cursor. The peer's agent long-polls forever. Flagged by the lifecycle auditor as the single highest-leverage fix in its report.

### C-4. A launch that never emits `system/init` jams its slot forever
`session-engine.js:331-365` — `startSession` sets `idleTimer: null` and never calls `scheduleIdle`; the timer is armed only by reducer effects requiring `launched`, dispatched only on `system/init`. A hung child sits at `phase:'launching'` with no watchdog; `hasLiveSession` stays true, every retry returns `{skipped:'busy'}`, the slot counts against `MAX_WINDOWS`, and no `task_started` was ever posted.

### C-5. Terminal states that post nothing — the requester's card pulses "Working…" forever
`session-effects.js:56-61` — `endLifecycle('abandoned')` returns `null`, so the 12h abandonment posts no message. Every other terminal reason posts (caps, operator End, close, crash). Same hole for the auth preflight hold (`session-engine.js:361-366` returns truthy, so `trigger.js:320-327` takes the success branch with no query ever run) and for eviction (`settle()` bypasses the reducer).

**Effect:** the *common* path — request → `task_started` → 15min idle → silent park → 12h → silent end — leaves the peer's UI claiming work in progress indefinitely. Parked records also reload as `'dormant'` and are skipped entirely (`session-engine.js:459-468`), so they're invisible on both ends.

### C-6. `propose_close` is one-shot forever; the UI is built on the opposite assumption — ✅ RESOLVED (2026-08-08, F-172), and the cron-key half with it (F-171)
*⚠ **This was NOT marked here until 2026-08-08, though both halves had been fixed** — the fixes landed in the findings log (F-171, F-172) and nothing propagated back to the audit, so this document went on reading as an open Tier-1 defect. Recorded as the correction rather than silently ticked: an audit doc that is only updated when someone remembers is an audit doc that over-reports.*

*The re-raisability half is F-172. **The cron-key half is F-171** — this finding's compounding note ("the cron writes the same key first, so it can STEAL the agent's genuine proposal and replace its reason with 'no activity for a while'") is closed by the stale-threads rewrite, which also fixed the clock that made the cron fire hardest on the busiest threads. Note the job had never executed once (`CRON_SECRET` unset), so neither defect was ever observable — see the CRON_SECRET item in "Questions for you" and F-171, because **shipping the fix is what turns the job on for the first time.***

`service-tasks-propose.ts:91` — `clientMsgId: close-proposed-${task.id}-${outcome}`, and `postMessage`'s idempotency returns the stored row without writing. But `lib/group-thread.ts:270-273` says "a long exchange can be proposed on, continue, and be proposed on again," and `session-card.tsx:126-129` deliberately keeps dismissal local so "the next real proposal" stays visible.

**Effect:** agent proposes → human keeps it open → work continues → agent finishes and proposes again → swallowed. The stale prompt returns on reload, forever. The agent's only terminal act is permanently consumed by its first use. Compounded by C-1: the cron writes the same key first, so it can *steal* the agent's genuine proposal and replace its reason with "no activity for a while."

### C-7. Local 24h consent expiry settles without running the resolver
`consent-watcher.js:313-317` returns before the poll; `MAX_WATCH_MS` equals `CONSENT_TTL_MS` and `rec.createdAt` is stamped after the insert, so the local check always wins. `inboundExpired` never runs → `closeConsentWindow` never runs → a pre-consent window left open for 24h **stays open forever** with a live Accept on a server-expired row, and `clearPermissionPreset` never runs, leaving the operator's chosen posture armed for the next launch. Expiry also posts nothing to the requester.

### C-8. App quit orphans running `claude` children
`index.js:329-332` — `before-quit` stops the listener but never iterates sessions, aborts a controller, or flushes a final push. Repo-wide the only `.kill(` is the auth pty. Each live `sdk.query()` holds a bundled `claude` child with pre-approved `dopl_channel` MCP access that can keep posting after the app is gone — the failure `session-engine.js:202-205` already fixed for the crash path only.

### C-9. Accepted-consent entries leak the window budget
`session-consent.js:206-215` — `decide()` marks decided but never removes the registry entry; removal happens only inside `startSession`, `close()`, or window close. Every `launch()` early return leaks (`{skipped:'disabled'|'auth-hold'|'busy'|'no-sdk'|'cap'}`, plus `trigger.js:243`). `atWindowCap()` counts them (`:58`) but `evictIdleShell` walks only `deps.sessions` — leaked entries are **not evictable**. Six and the desktop is permanently capped.

---

## Tier 2 — Containment and privilege

### C-10. A `full`-profile headless spawn gets **no containment at all**
`tool-profiles.js:220-222,252-254` — `buildDeniedTools`/`buildRestrictionArgs` short-circuit to `[]` for `full`. `session-spawner.js:291-298` therefore passes only `--mcp-config`: no `--allowedTools`, no `--disallowedTools`, no `--settings`, **no `--strict-mcp-config`**. The session processing an untrusted peer's message loads the operator's *global* MCP servers (Slack, Gmail, Supabase, every connector) and honours global `permissions.allow` unopposed.

The SDK lane already decided the opposite for the same profile name (`session-profiles.js:96-98,164` applies `SESSION_HARD_DENY` even under `full`). `full` is the **DB default** (`NOT NULL DEFAULT 'full'`), and the retirement test scopes its assertion to `RESTRICTED = ["read_only","dopl_only"]`, so the gap isn't covered.

### C-11. The tool profile **fails open** to `full`
`targeting-window.js:38-42` and `tool-profiles.js:209-211` coerce missing/unknown → `full`. The same app does the opposite one file over: `session-park.js:39-43` coerces unknown → `read_only`. `myAgentToolProfile` is `null` for non-member reads and unrefreshed DTOs. Nothing logs it, so an operator whose explicit `read_only` evaporated has no signal. Contradicts the stated discipline in `targeting.js:52-56` ("FAILS CLOSED") and the most-restrictive default in `use-channel-permission-preset.ts:44-48`.

### C-12. An agent can rewrite its own tool profile
`src/app/api/channels/[channelId]/members/route.ts:75` — `PATCH` has no `sessionOnly` and defaults to `minRole: viewer`, and it writes `agentToolProfile`. Trust (`trust/route.ts:51-66`) and consent (`consent/[id]/route.ts:47-65`) are both `sessionOnly` with comments describing exactly this threat model. A `full` session at `bypass` has live Bash, and `sdk-loader.js:104` fences only `Read/Grep/Glob` from secret paths — so it can read its own bearer and durably re-widen its profile after the operator tightens it.

### C-13. Agents can widen a channel's audience, unconfirmed
Invite is a first-class MCP op (`channel-ops-open.ts:118`) and **any** member may add anyone (`service-writes-members.ts:40-55`); visibility private→public is `minRole: member`, not `sessionOnly` (`route.ts:48`). Neither raises a consent card. Note the asymmetry: raising a prompt is `sessionOnly`-protected; exposing the entire transcript to the workspace is not. The UI compounds it — `channels-view-core.tsx:332-342` PATCHes visibility immediately with no dialog, while delete (reversible for a DM) gets a full destructive confirm.

### C-14. `close` is human-only; `reopen` and `set_thread_mode` are not
*(Found independently by three auditors.)* `service-tasks.ts:322` refuses agent callers on close. `reopenTask` (`:418-440`) has no such check, and the PATCH route is not `sessionOnly` — while `channel-description.ts:69` tells agents "Reopening is likewise a human's action." Separately `set_thread_mode` (`service-tasks.ts:388-406`) is creator-only with no agent check, and `autonomous` means `session-io.js:30` never holds for the operator — an agent can remove its own operator's hold on a thread it created.

### C-15. RLS leaks what the API scrubs, and ignores `deleted_at`
`dto.ts:185-210` nulls `notify_scope` / `agent_tool_profile` for everyone but the viewer, "so it holds for every path." RLS returns the whole row to any channel member (`20260725120000_channels.sql:180-192`), and `channel_members` is in the realtime publication — so who muted the channel and how tightly their agent is scoped is roster-public over CDC and from the browser console (`src/shared/supabase/browser.ts:27` ships the anon key). Separately, no channel policy filters `deleted_at` (`:152-160`, `:205-217`), so a "permanently deleted" channel's full transcript stays readable to members via PostgREST.

---

## Tier 3 — Semantics that contradict themselves

### C-16. Delete: three layers, three answers
*(All four auditors hit this.)* UI (our §2b edit) now says "This permanently deletes… can't be undone" with `confirmLabel="Delete permanently"` (`channel-pane.tsx:465-471`), and `channel-actions-menu.tsx:117-119` asserts soft-delete was removed. Server still soft-deletes (`service-writes.ts:299` → `repository.ts:246`). Migration `20260807110000` excludes channels explicitly, calling the column "LIVE PRODUCT STATE."

- **DM:** hide-until-reopened — either side's next open revives the same row with full history. The copy we replaced was the *only* user-facing statement of that mechanic, on the screen where it's the non-creator's only exit. **The dialog is now simply false.**
- **Non-DM:** no revive path exists (`reviveChannel`'s only caller is `reopenDirectChannel`), no restore route, no trash, excluded from the purge sweep, and the slug stays reserved forever (`repository.ts:126-137`). So "permanently deletes" actually means "hidden forever, retained forever" — and per C-15 still readable via RLS.

### C-17. The stale cron bypasses the serialized insert RPC and writes a NULL author
*(Two auditors.)* `stale-threads/route.ts:103` does a raw insert instead of `channel_message_insert`, whose advisory lock exists precisely so "an await cursor can't advance past a not-yet-visible lower seq." And it writes `author_user_id: null`, which every MCP `await` drops — `.neq("author_user_id", x)` is false for NULL (`repository-messages.ts:62,112`). ENGINEERING.md §8 says "no writer produces them today"; that's now false, and its stated remedy was never triggered.

**Effect:** the 14-day close proposal renders on the web card but is **invisible to any agent holding an await** — the exact surface the tool teaches every agent to keep armed.

### C-18. Notify scope: one option is dead code, another doesn't do what it says — ✅ RESOLVED BY REMOVAL (2026-08-08, F-170)
*Samuel's decision: the whole preference is deleted rather than repaired. The control, the schema field, the client wiring and `classify`'s read are gone; the server DTO, `trigger.js`'s `sendFyi` read and the column are F-170's open half, with a written-but-unapplied drop migration. **One correction to the finding below: the `targeting.js` read was not the only one — `main/trigger.js:73-78` also compares the scope, so `'addressed'` did suppress every FYI notification.** And note the consequence: nothing suppresses an implicit two-member trigger any more.*

`notify-scope-button.tsx:16-28` offers All / Addressed-to-me-only / Muted. The only runtime read is `targeting.js:240-248`: `'addressed'` is never compared anywhere (byte-identical to `'all'`), and `'none'` suppresses only the *implicit* two-member trigger — an explicitly addressed message still spawns a session. Both behaviours are asserted as intended in `test/classify.test.mjs:85-118`.

### C-19. Trust is workspace-wide; the only grant surface is a per-channel popover — ✅ FULLY RESOLVED (label 2026-08-08 F-174; revocation 2026-08-08 F-174 open half)
*Samuel's decision: workspace-wide is right; the control stays where it is and the COPY carries the scope. It now states that trust covers every channel and DM you share with someone including ones created later, that their requests skip the approval card, and which tool scope the resulting session gets. It also renders an empty state instead of vanishing on a roster of one — the reason a single-member workspace never saw the setting at all.*

*✅ **AND THE SERVER HALF IS NOW CLOSED TOO (2026-08-08, consume-time re-verification).** This finding's residual — revocation cannot stop an in-flight `auto_allowed` row, because trust was checked once at create — is fixed. `consent-service.revalidateAutoAllow` re-derives trust on the way out of every path that can authorize: `getConsentRequest` and BOTH create-converge paths (idempotent-existing and the 23505 race), so de-duping cannot resurrect a revoked allow either. A row failing re-verification is CAS'd to `expired`, with a re-read on a lost CAS and a vanished row reading as expired; a null `requester_user_id` fails closed. **No migration, and old desktops fail closed with no client change** — `expired` already maps to `inboundExpired`, which is exactly why this lives on the server read path. `listConsentRequests` is deliberately unswept (audit surface; nothing authorizes from it). Two bounds recorded rather than implied: the guard is **HTTP-layer only** (Realtime/PostgREST hand out the raw row — a future optimization that reads the subscription payload instead of refetching steps around it), and the crash-recovery replay path can retire an already-consumed row, costing an audit-trail entry. See F-174 and ENGINEERING §8 v1.2.*

*(Two auditors.)* `UNIQUE (operator_user_id, trusted_user_id, workspace_id)` — no channel column. The toggle lives in the **channel** settings popover next to the per-channel tool profile, captioned only "Trusted teammates' requests run without a prompt." Flipping it in one channel auto-allows that person in every channel and DM in the workspace, including ones created later, each spawning under its own channel's profile (default `full`). Auto-allow raises no card, so the blast-radius line is never shown. Revocation also can't stop an in-flight `auto_allowed` row (`consent-service.ts:98-119` checks trust once, at create, and the row has `expires_at: null`).

### C-20. Deactivated members stay addressable — ⚠ ADDRESSING HALF CLOSED (2026-08-10); the sweep and the orphaned-thread note are STILL OPEN

*✅ **The addressing check is fixed.** Both write paths now assert active workspace membership on the addressee IN ADDITION TO channel membership, and fail closed on the existing `ChannelAddresseeNotMemberError`: `service-writes.ts:392-395` (`postMessage`) and `service-tasks.ts:232-235` (`createTask`). The same assertion also guards the add-member path at `service-writes.ts:129`. `isActiveWorkspaceMember` lives at `repository.ts:471`. So the scenario this finding opens with — `create_thread` succeeds, the requester arms `await`, nothing ever answers — is now a 400 at the point of addressing instead of a silent forever-wait. Pinned by `service-writes.test.ts` and `service-tasks.test.ts`.*

*⚠ **Two things survive, and neither is a one-liner.** (1) **Nothing still sweeps `channel_members` on workspace leave.** The membership row outlives the departure; only the addressing check now refuses to act on it. That means the roster keeps rendering a departed member and every read path still counts them — including the implicit-trigger rule, which keys on MEMBER COUNT (F-100's standing rule), so a channel can read as a 3-party channel on the strength of someone who left. The fix is cron-shaped (a sweep, `CRON_SECRET`-gated like F-064's consent expiry, which is itself inert until F-133 sets the secret), not a service edit. (2) **The orphaned-thread-on-mid-thread-removal note is untouched** — nothing sweeps `channel_tasks`, the survivor can close the thread but is never told to. **Do not read the addressing fix as closing this finding.***

Addressing checks channel membership only (`service-writes.ts:345-347`, `service-tasks.ts:213-215`), never `isActiveWorkspaceMember`, and nothing sweeps `channel_members` when someone leaves the workspace. Trust does this correctly and says why (`trust-service.ts:37-48`: "a rule outlives the teammate leaving"). **Effect:** `create_thread` succeeds, the opening message posts, `openingSeq` returns, the requester arms `await` — and nothing will ever answer. Exactly the undeliverability v2.6 exists to prevent, reached from the other end. Related: removing a member mid-thread orphans the thread (nothing sweeps `channel_tasks`; the survivor can close it but is never told to).

---

## Tier 4 — Client wiring and races

### C-21. Channel switch renders the previous channel's content under the new header — ⚠ COMPOSER HALF CLOSED (2026-08-08, F-178 M4); the `keepPreviousData` question is STILL OPEN
*The **addressee** half is fixed: `useChannelMembers` was `keepPreviousData` with no `isPlaceholderData` exposed, which is exactly this finding's "nobody reads `isPlaceholderData`" applied to the roster. Both per-channel reads now return `stale`, and the gate lives in the PURE decision layer (`lib/composer-mode.ts`: `rosterStale` → a `stale-roster` blocked reason), **checked BEFORE the target resolves so the help line cannot name the wrong person** — which was this finding's most user-visible detail. Send is disabled with "Loading who's in this channel…", the address picker is hidden while stale (a name picked off the stale list would still sit in `toUserId` when the gate opened), and chat mode is deliberately not gated because it reads no roster.*

*⚠ **THE FINDING ITSELF IS NOT CLOSED, and the decision it asks for is still unmade.** Two things survive. (1) The **thread-close** half — a stale `threadId` posted to the new `selected.id` → 404 — was not addressed by M4 and is not gated by `rosterStale`. (2) More importantly, **the question in "Questions for you" below is the real item**: drop `keepPreviousData` on the three per-channel queries, or keep it and gate every consumer on `isPlaceholderData`? M4 took the second road for ONE consumer because that consumer had a live bug. That is a fix, not an answer — every future reader of those three queries inherits the same trap, and the next one will not have an incident to prompt it. **Answer the question or the finding regenerates.***

`channels-view-core.tsx:136-149` — messages/members/threads all use `keepPreviousData`, so `isPending` is false and `channel-pane.tsx:374-379` skips the loading state; nobody reads `isPlaceholderData`. `ChannelPane` remounts (keyed) but its props are the parent's stale queries. In that window: closing a thread posts the stale `threadId` to the **new** `selected.id` → 404 + "Couldn't close the thread"; and a DM's implicit addressee resolves from the previous channel's roster (`message-composer.tsx:116-122`), so a Request is addressed to a non-participant — with the help line naming that person.

### C-22. Request mode can send to a non-member, with Send enabled
`buildComposerPayload` only checks `toUserId` non-null (`lib/composer-mode.ts:236-242`); the picker silently reverts its chip when the member leaves (`address-picker.tsx:55`) without clearing `toUserId`. Operator sees no addressee, help text "Pick who this is for," and an **enabled** Send.

### C-23. No `clientMsgId` on web sends → duplicate message + duplicate peer trigger
*(Two auditors.)* `channels-view-core.tsx:233-246` posts `{body, intent}` only, though the field exists end-to-end with a unique index and the desktop sets one deterministically (`channel-post.js:55`). Main aborts at 30s; if the abort fires after the server committed, the user retries a preserved draft and gets a second row — and in a two-person channel, a second session spawn on the peer's machine. Same shape on thread create.

### C-24. Session-window steer clears the draft before anything confirms delivery
`renderer/session/session.js:389-400` appends the turn and empties the input; `session-preload.js:129-131` **swallows the invoke promise** (not returned, no catch). The peer path in the same window does this correctly (`session-address-ui.js:229-235` returns false, reconciles by `localId`). Operator sees their words in the window, an empty composer, and an agent that never runs.

### C-25. Two consent cards for one channel overwrite each other's permission preset — ✅ RESOLVED (2026-08-08, F-174)
*Fixed as a precondition of putting the same arm in the channel settings popover, which would otherwise have made the two-surface case the ORDINARY one rather than the two-card edge. A write now merges onto what is STORED (re-read immediately before the set) instead of onto the writer's mount snapshot, and broadcasts the settled pair to every mounted reader of that channel, so neither surface can revert the other's axis or go on displaying a posture it no longer has. `use-channel-folder`'s same-shaped comment is still wrong and is still lower-stakes; it was left alone.*

`use-channel-permission-preset.ts:143-160` is per-component state with no shared store; `update` sends `{...preset, ...patch}` from a snapshot taken at mount. Card A sets Tools=Bypass; card B (stale) sets Messages=Automatic and **reverts A's tools** while A still displays Bypass. Directly breaks the row's own contract ("Never leave the card claiming a posture that was not stored"). Same shape, lower stakes, for the agent folder (`use-channel-folder.ts`), whose comment claims the opposite of what it does.

### C-26. `channel_tasks` is in no realtime table set
Not in `CHANNEL_TABLES` (`constants.ts:6-10`) nor `SYNC_TABLES` (`ui-sync.js:71-79`), and reopen deliberately posts no echo. The other party's card stays "closed" until an unrelated message lands or they navigate. Also makes reopen silent to the peer (C-14).

### C-27. The refetch coordinator covers 2 of 6 mutation families — ✅ RESOLVED FOR CHANNELS (2026-08-08, F-159)
*All five families are on the shared write layer and **every one of them is gated** — the coordinator gate is REQUIRED on the lifecycle writes, not optional. The five lifecycle writes moved to `use-channel-lifecycle-writes.ts` and the header that read "deliberately still on the old await-then-refetch envelope" is gone; notify scope left the product entirely (C-18 / F-170) and tool profile + trust go through `use-channel-preference-writes.ts`.*

*⚠ **THE OVERRIDE MAPS ARE GONE, which makes the gate load-bearing rather than belt-and-braces.** This finding's sharpest sentence was that the coordinator *isn't* what protected these writes — the override maps were, and "removing an override map to simplify loses the protection silently." The maps are now deleted (they were the four hand-rolled `useState` records the layer subsumed). So the warning inverts: **the gate is the only thing standing between a realtime doorbell and an unsent local change, and a future write added to this feature without `settleWith` has nothing behind it.** The double-click hole closes the same way — `pendingRow` on the control, per §7 rule 8, rather than an in-flight guard per call site.*

*Scope note: this is closed **for channels**. The finding's shape — a coordinator wired into some write paths and not others — is not asserted to be closed anywhere else.*

`channels-view-core.tsx:179-194` — `busyRef` is incremented only in `handleSend` and `runThreadMutation`. Archive/visibility/delete/join/leave, notify scope, tool profile, trust and consent all bypass it and race the doorbell's four refetches. They survive only because the **override maps** shadow the server value — so the coordinator isn't what protects them, and removing an override map to "simplify" loses the protection silently. Notify-scope and tool-profile additionally have no in-flight guard (trust and consent do), so two fast clicks destroy the shared override mid-flight and can land the operator on their *first* pick with no error.

### C-28. Three surfaces disagree about one session's state
Pills read the desktop registry, cards read server rows, `read_sessions` reads `channel_sessions`. Same thread can simultaneously show pill=**Ended**, card=**Thread active** *plus* "the session stopped," panel=**Thread active**. Each is right in its own frame; nothing reconciles them. Compounded by C-2 (the third transport is lossy) and by `session-state-push` having no repair path for a *final* state change (`session-state-push.js:297-306` relies on "the next real state change is the retry" — a session that ends during a 30s blip reports `working` for the life of the process, and this app runs for weeks).

### C-29. Two machines of one user clobber each other's session rows
`replaceSessionStates` is scoped to `(userId, workspaceId)` and deletes anything not in the report (`repository-sessions.ts:161-208`). A laptop and a desktop each push their whole set; each deletes the other's. `read_sessions` flip-flops.

### C-30. `closeTask` has no already-closed guard
`service-tasks.ts:326-342` updates unconditionally, and the close echo carries **no** `clientMsgId`. Both parties may close: A closes `completed`, B closes `failed` → two echoes in the transcript, final outcome is whoever wrote last.

---

## Tier 5 — Smaller but real

- **Pause works once per session.** `session-reducer.js:355-360` sets `interrupted`; `:347` carries it forward and `result` never clears it. The pause morph is gone for the session's life, the header reads "Interrupted" over active work, and it persists → spurious `task_failed{interrupted}` on next boot.
- **Attended handoff leaves the row pending** (`session-ipc.js:183-186`) — operator answers in Claude Code, a later Accept spawns a second session answering the same request.
- **Desktop Accept is fire-and-forget** (`session-consent.js:192-202`, no await, no retry) over a one-shot transition — a flaky PATCH leaves the row pending with the button dead.
- **`isAbortError` swallows real crashes** (`session-query.js:134-136`, `/abort/i` on the message) — SIGABRT reads as intentional teardown, so no crash dispatch, no `task_failed`.
- **`evictIdleShell` can settle a window mid-sign-in** (`session-auth.js:311-315` never calls `touch()`), then `resumeAfterSignIn` spawns a child on a destroyed session — invisible to tray, pills and push.
- **A long single turn is torn down mid-flight** — the idle timer re-arms only at turn boundaries, so a 20-minute tool run hits `idle_timeout` and shows "Paused after inactivity" over a session that was busy throughout.
- **Archived channels accept everything** — posts land, threads open, sessions spawn; only `listChannels` hides them.
- **N≥3 durability starts at the recipient's desktop** — if Carol's Mac is asleep or Dopl isn't installed, no consent row exists anywhere and no server record shows she was asked.
- **`opInvite` catches only `isAlreadyExists`** (`channel-ops-open.ts:117-124`) — the documented precondition failure (403) propagates as a raw framework throw; `classifyForbidden` exists and is never imported here.
- **The handoff over-claim survives where agents read it first** — the *result* copy was fixed, but `channel-description.ts:66` and `channel-schema.ts:228` still say "it opens a full session… you are DONE (do not arm await)."
- **~~`registerMetaTool` bypasses every gate~~ (was `server.ts:913-925`) — ✅ FIXED 2026-08-07, before this line was ever actioned.** The four gates were HOISTED OUT of the `registerTool` wrapper into `isSuppressedTool` + `opRefusal` precisely because `registerMetaTool` registers straight onto the SDK server. Both live in `packages/mcp-server/src/gating.ts` now (`registrar.ts` holds the two registrars, `meta-tools.ts` the two meta-tools) after the 2026-08-08 split — **the constants moved; the gate topology did not.** `meta-gate.test.ts` pins it (7 tests). Worth keeping the finding: it was correct, and it was correct about a path rather than about the two tools on it, which is why it was fixed even though it was inert.
- **"Rooms" vocabulary survives** in `rooms-sidebar.tsx` (label, heading, empty states) while the popover over the same data says "Threads" — v3.0 says `thread` everywhere a human reads.
- **UI manage gate is narrower than the server's** — `channel-pane.tsx:134` is owner-only; the server also allows workspace admins, who can delete a public channel they aren't even a member of, invisibly.
- **Bridge-path catch-up fires the four-refetch fan-out on every subscribe/reconnect/wake**, filtered by `workspace_id` — a message in any channel refetches the selected channel's messages, members and threads. Worth measuring given the 82.7%-of-DB history.
- **Session-pill "Open" discards main's refusal** (`session-pills-bar.tsx:121-128`) — `{ok:false, reason:'busy'|'no-thread'}` dropped; the same op from the card handles both.
- **A single failed `syncWatch` kills desktop live updates** with no retry timer (`shared-channel-registry.ts:390-430`) until the user navigates away and back.
- **No timeout on the web send path** (`api-client.ts:95-101`) — a hung request leaves `sending` true forever: button dead, draft frozen, no recovery but reload.
- Docs drift: reserved-key list in §8 F-113 is missing four keys added since; "postMessage IS ONE WRITE" is two writes; `internalLifecycle`'s motivating case is unreachable; `channel_sessions` migration `20260805120000` is still **unapplied** (reads degrade silently to `[]` while every desktop push 500s).

---

## Questions for you

Grouped by decision, not by finding. Each unblocks several fixes.

**Delete semantics (C-16, C-15, EC-3)** — Is delete permanent, or is it DM close/reopen? Three options: (a) hard-delete non-DMs, keep soft-delete only for `is_direct` — then "permanent" is true for one branch and you're deciding whether one side may destroy a shared transcript; (b) keep soft-delete and revert the copy to "hidden / reopening brings it back"; (c) add an owner-visible restore. Today it's (b)'s behaviour with (a)'s copy. **My read: the DM copy change was collateral from the §2b sweep and should be reverted regardless** — that sentence was the only place the revive mechanic was explained to users.

**What does `full` mean? (C-10, C-11, C-12)** — "No containment" or "the widest *contained* profile"? The headless and SDK lanes already disagree; it's a one-line change either way but it changes what "Full access" promises on the consent card. Related: fail-open or fail-closed on an unknown profile (the app does both, in two files, both deliberately)? And is `agent_tool_profile` a containment control (→ needs `sessionOnly` like trust/consent) or a preference?

**Trust scope (C-19)** — Workspace-wide as implemented but presented per-channel. If workspace-wide is right, the control belongs in workspace settings. If per-channel is right, the table needs a channel column.

**~~Mute semantics (C-18)~~ — ANSWERED 2026-08-08: neither. The preference is removed (F-170).** There is no mute to give semantics to. The live question that replaces it is narrower and worth asking deliberately: **nothing suppresses an implicit two-member trigger any more** — is a replacement wanted, and if so what should it mean? Whatever the answer, it is a fresh design; the old three options are not a starting point.

**Human-only actions (C-14)** — Should `reopen` refuse agent tokens like `close` does? Should `set_thread_mode(autonomous)` — which removes your hold — be human-only too? And should widening a channel's audience (invite / go public) be gated like consent is?

**`propose_close` (C-6)** — Re-raisable or one-shot? Options: drop the `clientMsgId`, scope it to `(thread, outcome, seq-window)`, or keep one-shot and fix the two UI comments. Related: should the cron and the agent share a key at all, given the cron can steal the agent's reason?

**Ad-hoc sessions (C-2)** — Should a `task-<channel>-<seq>` session appear in `read_sessions`? If yes, widen the server schema; if no, filter those rows before the POST rather than letting one poison the array.

**Terminal silence (C-5, C-7)** — What should abandonment, the auth hold, and consent expiry say to the peer? A calm `task_progress{session_ended}` matches the operator-End precedent — but abandonment means nobody was there to decide it.

**Cursor ordering (C-3)** — Can `setCursor` move to *after* `dispatchMessage`, or does something depend on the current order to avoid re-dispatch loops? Highest-leverage single fix in the audit.

**Realtime budget (C-26, and the fan-out note)** — Add `channel_tasks` to the publication so reopen propagates, or make reopen post a lifecycle echo so the existing `channel_messages` doorbell carries it? The second avoids growing a publication you've just been shrinking.

**`keepPreviousData` (C-21)** — Drop it on the three per-channel queries (the pane remounts anyway, so it buys a stale-content window rather than a smooth one), or keep it and gate the composer and card controls on `isPlaceholderData`?

**Quit behaviour (C-8)** — Should `before-quit` abort live queries and flush `{sessions: []}`, or is an orphaned child that keeps working ever desirable?

**Cron activity clock (C-1)** — Trigger on `channel_tasks`, touch in `postMessage`, or a `channel_messages` subquery? Three different cost profiles, and shipping any of them turns the cron on for the first time against a 14-day backlog.

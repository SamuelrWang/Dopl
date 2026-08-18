# Channels v2 — wiring plan

Status: PLAN, partly executed. Written 2026-08-18 against the tree at `c18b64ea`.
**Phase 0 and Phase 1 have LANDED (2026-08-18); everything from Phase 2 down is
still unbuilt.** The phases below are left as written — they are the intent, not a
progress log. ⚠ Current state lives in `docs/INVARIANTS.md` (§5 for the activity
clock and the thread ordering, §9 for the bounded read), never here.
Source of intent: `apps/desktop-ui/src/pages/channels-v2/MAPPING.md`. Source of current
behaviour: `docs/INVARIANTS.md` §5 §6 §7 §8 §10 §11 §14 and the code, in that precedence
order (repo CLAUDE.md).

## Shape of the port

**What stays.** The whole server spine: `channels/server/repository*.ts`,
`service-writes*.ts`, `service-tasks.ts › createTask`, `consent-service.ts`,
`http-mapping.ts › toChannelErrorResponse`, the `channel_message_insert` RPC path, the
consent row model and its TTL/re-derivation (INVARIANTS §6), the write layer
(`use-thread-writes.ts › sendConfig` / `› openThreadConfig`), the channel-management
surface (`create-channel-dialog.tsx`, `invite-dialog.tsx`, `go-public-dialog.tsx`,
`channel-actions-menu.tsx`, `channel-folder-control.tsx`), the desktop consent →
watcher → spawn pipeline, the onboarding explainer (`channels-onboarding-core.tsx`),
and `task` == `thread` at storage (INVARIANTS §5 — **no storage rename is proposed
anywhere in this plan**).

**What dies.** Thread close/propose/reopen and everything downstream of it; the calm-flag
terminal reads; the stale-threads cron's close proposals; session cards and the
`group-thread*` render machinery; the session pills bar; the composer intent pill and
`composer-mode.ts`; the DM implicit trigger and its fail-quiet auto-address; per-message
desktop notifications (`trigger.js › sendFyi`, `task-notify.js › notifyTaskReply`); the
per-thread session window as the *default* landing surface; the consent card as the
decision UI.

**What is new.** Mention/tag addressing of the operator (parse → server-stamped reserved
metadata → notification escalation → Tags inbox with real read-state, which has **no
backing column today**); launch settings replacing the consent card (reusing
`permission-preset-row.tsx` and `use-channel-folder.ts` wholesale); request fan-out (one
`channel_tasks` row per addressee, rendered as one card); activity-sorted thread lists
with no status filter; the Agents tab + agent view over a widened desktop session
projection; an opt-in pop-out thread window; MCP prose for sparse channel posting and the
tagging capability.

**The through-line for every phase: one seam per concern, and the machinery a phase
obsoletes is deleted in that same phase.** No phase may leave a dead module, a dead
`require`, or a mention that is not annotated as history — `dopl-desktop-app/test/removed-vocabulary.test.mjs`
enforces that on the desktop side and is the model for the rest.

### The definition of green — referenced as **GREEN** below

Every phase ends on the full table in INVARIANTS §14, not `npm run test:all`:

```
npm test                                   # root
npm test -w @dopl/client
npm test -w @dopl/mcp-server
npm test -w @dopl/desktop-ui
cd dopl-desktop-app && npm test && npm run lint
npx eslint                                 # root
npm run typecheck
npm run typecheck -w @dopl/desktop-ui      # SPA is outside the root tsconfig
node scripts/check-doc-refs.mjs            # NOT covered by npm run lint
npx tsx scripts/check-knowledge-type-drift.ts
# plus the size-check CI job (500-line cap over packages/)
```

Every phase also ends with its doc ritual: INVARIANTS updated in the same change, the
*why* in ENGINEERING.md only where the rationale is worth keeping, new/resolved debt in
REFACTOR-FINDINGS.md, Dopl KB synced.

---

## Phase 0 — Truth-up: three stale claims the plan is built on

**Size: S.** Docs + findings only. No product code.

**Goal.** Two load-bearing premises in MAPPING.md are false against the tree, and the plan
would be wrong if built on them. Correct the docblocks, file the findings, re-measure.

**The disagreements** (see *MAPPING vs code* at the tail for the evidence):

1. `apps/desktop-ui/src/pages/channels/index.tsx › ChannelsPage` docblock says
   "REALTIME IS OFF HERE … `shared-channel-registry.ts` short-circuits on `window.dopl`".
   It does not short-circuit — `src/shared/realtime/shared-channel-registry.ts ›
   subscribeSharedWorkspaceTables` routes to `› subscribeViaBridge` when the SPA bridge
   exposes `onSyncEvent` + `syncWatch`, and `dopl-desktop-app/renderer/app-preload.js`
   exposes both. `channel_messages`, `channels`, `channel_members`,
   `channel_consent_requests` and `agent_presence` are all in
   `dopl-desktop-app/main/ui-sync.js › SYNC_TABLES`.
2. The same docblock says the consent card's desktop rows are "NOT WIRED … the SPA preload
   does not expose" `window.dopl.channels`. It does — five ops, and
   `dopl-desktop-app/test/preload-parity.test.mjs › APP_OPS` names
   `channels.chooseFolder` as "the consent card's folder row".
3. `apps/desktop-ui/src/components/app-shell/app-shell.tsx › AppShellLayout` carries the
   same "realtime is a no-op in the SPA" claim on its consent poll.

**Files/symbols.** `apps/desktop-ui/src/pages/channels/index.tsx › ChannelsPage`,
`apps/desktop-ui/src/components/app-shell/app-shell.tsx › AppShellLayout`,
`apps/desktop-ui/src/pages/channels-v2/MAPPING.md` (§ *Not represented in the mock*),
`docs/REFACTOR-FINDINGS.md` (allocate **F-199**, **F-200** — next free id is F-199 as of
2026-08-11), `docs/INVARIANTS.md` §7.

**Retires.** Nothing. It retires two false claims.

**INVARIANTS.** §7 gains an explicit statement that the SPA rides the ui-sync doorbell
rather than being realtime-dark — verified against
`dopl-desktop-app/main/ui-sync.js › SYNC_TABLES` and `test/ui-sync-tables.test.mjs`, not
from memory.

**Gates.** GREEN. Plus: a test that asserts the SPA path is the bridge path rather than a
no-op — `shared-channel-registry.test.ts` already exercises `subscribeViaBridge`; extend it
to pin the CHANNEL tables specifically, so a future `SYNC_TABLES` edit that drops
`channel_messages` fails here rather than silently freezing the transcript.

**Why first.** Phases 5, 6, 7 and 10 all budget differently depending on whether inbound
traffic is live. Getting this wrong costs a polling layer nobody needs.

---

## Phase 1 — The read model: threads never close, sorted by activity

**Size: M.**

**Goal.** Make "threads are kept forever and sorted by activity" true in the read path
BEFORE any UI depends on it, and before the close machinery is removed (so the removal has
somewhere to land).

**Files/symbols.**
- `src/features/channels/server/repository-tasks.ts › listTasksByChannel` — today it is
  `select("*")` ordered by `created_at DESC` with no limit (a §9 non-conformer). Replace
  the ordering with LAST ACTIVITY. The derivation already exists and is already reasoned:
  `supabase/migrations/20260807160000_channel_tasks_stale_activity.sql` reads activity off
  `channel_messages` precisely because `channel_tasks.updated_at`'s only writers are
  close/set_mode/reopen (INVARIANTS §5). Reuse that shape; do **not** invent a second
  activity clock and do **not** tax the write path (INVARIANTS §12).
- Same function: select COLUMNS, add a `limit`, and say so when clipped (INVARIANTS §9).
- `src/features/channels/server/dto.ts › mapTaskRow` — carry `lastActivityAt`.
- `packages/mcp-server/src/tools/channel-render-threads.ts` — `list_threads` renders in the
  same order, so the two surfaces cannot disagree about which thread is live.

**Retires.** The Active/Inactive *filter* as a data concept. `info-panel.tsx › ThreadsTab`'s
`STATUS_FILTERS` / `IN_FILTER` do not survive the port (MAPPING third round). Nothing is
deleted yet — this phase only stops anything NEW depending on `status`.

**INVARIANTS.** §5 (the activity clock statement moves from "the stale sweep's clock" to a
general rule about thread ordering), §9 (one non-conformer resolved — say so, with the
measurement date).

**Gates.** GREEN. Plus a repository test that a thread with old `created_at` and new traffic
sorts ABOVE a thread with new `created_at` and none — reverted, it must go red
(mutation-verify, INVARIANTS §14: state "N reverts, N failures, 0 vacuous").

**Answered (Samuel, 2026-08-18).** The sidebar tree shows threads **active within the
last 24 hours OR requested**; the Threads tab lists everything, paged, sorted by
activity. Record the window as a constant with its date; the repository read still takes
a limit and says when it clipped (§9).

---

## Phase 2 — The three-column shell on real reads

**Size: L.** The biggest single phase; keep it read-only so it can ship behind the existing
`channels-v2` route without touching the shipping page.

**Goal.** Every column of the mock renders real data. No writes. The old page stays live.

**Files/symbols.**
- New: `src/features/channels/components/channels-v2/` (web tree, Next-free, so the SPA can
  bundle it — the constraint `channels-view-core.tsx` already documents). Ported from
  `apps/desktop-ui/src/pages/channels-v2/{sidebar,message-pane,info-panel,bits}.tsx`.
  **The 500-line cap applies to `apps/*/src/**` and `src/**` alike (INVARIANTS §1)** —
  `message-pane.tsx` + a live transcript will not fit one file; split by responsibility
  (header/breadcrumb, transcript, message row) at design time, not when lint says so.
- Reads, all existing, all reused: `hooks/use-channels.ts`, `use-channel-messages.ts`,
  `use-channel-members.ts`, `use-channel-threads.ts`, `use-consent-inbox.ts`,
  `use-trust-rules.ts`. **No new hook layer.**
- Realtime: `client/realtime.ts › useChannelsRealtime` + `usePresenceRealtime` through
  `shared/realtime/refetch-coordinator.ts` — mandatory for any new live surface
  (INVARIANTS §7), and live for real in the SPA per Phase 0.
- Sidebar nesting: threads grouped by `channel_id`, ordered by Phase 1's activity.
- `apps/desktop-ui/src/pages/channels-v2/index.tsx` becomes a thin seam like
  `pages/channels/index.tsx` is today.

**Retires.** The mock fixtures (`mock-data.ts`, `mock-threads.ts`, `mock-agents.ts`,
`mock-mentions.ts`) go as each surface is wired — do not leave a fixture feeding a wired
component.

**Not in this phase, and say so in the code:** the Agents tab renders an explicit "not
wired yet" state rather than mock agents; `LINKED_THREADS`, `THREAD_ACTIVITY` (the heatmap),
`NAV_ROWS`' Assistant/Drafts/Saved-items and Favorites have **no backing data of any kind**
— see *Risks*.

**Interaction completeness (Samuel, 2026-08-18).** Every disclosure and dropdown must
FUNCTION in the wired page — section collapse chevrons in the sidebar, the Tags
disclosure, tab rows, any filter — no inert chrome carried over from the mock. The mock's
inert-by-design controls become real controls here or are explicitly listed as hardcoded
furniture (Risk 9).

**INVARIANTS.** §5 (the alignment/authorship rule — `authorKind` is a display claim, never
an authentication fact — restated where the new transcript renders it), §7 (new live
surface registered), §9 if any read is added.

**Gates.** GREEN. Plus `npm run typecheck -w @dopl/desktop-ui` is the only compile-time
cover the SPA has — treat a red there as a P0, not an afterthought.

---

## Phase 3 — The New-agent-thread panel, and the request fan-out

**Size: L.**

**Goal.** The panel becomes the ONLY path that raises an agent request; N pills = N
addressees = N `channel_tasks` rows rendered as one card.

**Files/symbols.**
- `src/features/channels/components/channels-v2/composer.tsx` ← mock
  `composer.tsx › AgentRequestPanel`; the posted card ← `message-pane.tsx ›
  ThreadRequestCard` on `bits.tsx › MESSAGE_CARD`.
- New service: `channels/server/service-tasks.ts` gains a fan-out entry point that loops
  `› createTask` per addressee. **`createTask` is not modified** — a thread stays one
  requester + one target (INVARIANTS §5), and the fan-out is a caller.
- ⚠ **Idempotency is load-bearing here.** `channel_tasks` carries a partial unique index on
  `(channel_id, client_msg_id)` (`20260729032037_channel_tasks_client_msg_id.sql`), so a
  single `clientMsgId` across N addressees makes rows 2..N converge on row 1 via
  `› convergeOnThread` and the request silently reaches one person. Mint
  `${base}:${toUserId}` per addressee and pin it with a test that a 3-pill send produces 3
  rows.
- Grouping: the N rows need one shared id so the transcript renders ONE card. Cheapest seam
  that respects the reserved-metadata rule: stamp the fan-out group id server-side in
  `service-writes-metadata.ts › resolvePostMetadata` (stripped from caller input,
  re-stamped only from the validated create — the same treatment `taskTitle`/`taskTarget`
  already get). A column on `channel_tasks` is the alternative; prefer metadata unless the
  read needs to index on it.
- Addressing ENFORCEMENT: an empty pill set is not sendable, and the plain textarea can no
  longer be sent unaddressed-but-intending-work. `constants.ts › GROUP_CHANNEL_MIN_MEMBERS`
  and its deliberate duplicate in `packages/mcp-server/src/tools/channel-addressing.ts` are
  untouched — the rule is unchanged, only its UI expression.

**Retires, in this phase, completely:**
- `components/composer-intent-pill.tsx` + `lib/composer-mode.ts` + `composer-mode.test.ts`
  + `apps/desktop-ui/src/features/channels/composer-intent-pill.test.tsx`. The plain
  composer is human chat, full stop.
- The DM implicit trigger and the fail-quiet DM auto-address: the `peerUserId` fallback in
  `service-writes-metadata.ts` and the `knownTwo && isMember` branch in
  `dopl-desktop-app/main/targeting.js › classify`.
  ⚠ **This is a desktop+web pair and it is SHIP-ORDERED (INVARIANTS §13): web first,
  desktop after.** An old desktop against a new server keeps triggering on 2-member
  channels until it updates; a new desktop against an old server is the direction that
  breaks. Also note `classify`'s body is sliced verbatim by four harnesses
  (`test/classify.test.mjs`, `test/_classify-harness.mjs`, `test/main-audit-targeting`,
  `test/live/desktop.js`) — the brace-balancing extractor constrains how the branch is
  removed.

**INVARIANTS.** §5 — the addressing bullets change materially: the implicit-trigger
sentence and the DM auto-address bullet both retire; the fail-closed rule stays and gets
*stronger*. Say which. §8 if the fan-out write needs `coldKeys` (it will: the thread list
may be cold on first render).

**Gates.** GREEN. Plus: `channel-addressing-rule.test.ts` re-run and updated (it pins the
web/MCP duplicate against each other); `dopl-desktop-app/test/classify.test.mjs`'s truth
table shrinks — assert the new table is smaller *and* that the removed rows are gone for the
stated reason, not merely absent.

---

## Phase 4 — Thread closing is removed

**Size: L.** The single largest retirement. Sequence it as one phase so no surface is left
half-closable.

**Goal.** No close, no propose-then-confirm, no reopen. The user pauses or ends AGENTS
(Phase 5), not threads.

**Deletes.**
- Server: `service-tasks-lifecycle.ts` (`› closeTask`, `› reopenTask`, `› closeEchoClientMsgId`,
  `› reopenEchoClientMsgId`), `service-tasks-propose.ts › proposeTaskClose`, the `close` /
  `propose_close` / `reopen` arms of `schema.ts › TaskUpdateSchema`, the matching arms of
  `src/app/api/channels/[channelId]/tasks/[taskId]/route.ts › handlePatch`, the
  `CHANNEL_CLOSE_IS_HUMAN_ONLY` error, `repository-tasks.ts › updateTaskIfStatus`
  (first-close-wins has nothing left to guard).
- Markers: `service-writes-metadata-markers.ts › CLOSE_PROPOSAL_KEYS` and
  `› REOPEN_MARKER_KEY` leave the re-stamp list. ⚠ **`CALM_FLAG_KEYS` is a different
  question and must be decided, not assumed.** Six keys (`declined`, `dropped`,
  `interrupted`, `capped`, `ended`, `session_ended`) — the *terminal reads* die with
  `calmTerminalStatus`, but `declined` is written by the consent DENY echo in `trigger.js`
  and `session_ended` changes how the peer's card READS. Keep the keys RESERVED (the strip
  is what keeps them unforgeable — INVARIANTS §5 says this in as many words) even where no
  reader is left; delete only the readers.
- Cron: `src/app/api/cron/stale-threads/route.ts` — the close-proposal body and
  `sweepClientMsgId` go. Decide whether the route dies entirely or becomes something else;
  if it dies, `vercel.json` and INVARIANTS §13's "three crons" count both change, and
  `repository-tasks.ts › listStaleOpenThreads` + the `channel_tasks_stale` RPC lose their
  only caller. Deleting the RPC is a migration; deleting the caller is not — do the caller
  in this phase and file the migration as tracked debt if it does not fit.
- Client: `hooks/use-thread-writes.ts › threadOpConfig` and the `ThreadOpDraft` type;
  `components/session-card-close.tsx`, `session-card-close-proposal.test.tsx`;
  `lib/group-thread-markers.ts › calmTerminalStatus` / `isThreadReopenedMarker`;
  the close/reopen paths through `channel-pane.tsx` and `channels-view-core.tsx ›
  handleCloseThread` / `› handleReopenThread`.
- MCP: `channel-description.ts › CHANNEL_DESCRIPTION` loses `"propose_close"`,
  `"close_thread"`, "PROPOSE closing", "until they act the thread is open", and the
  `list_threads` / `get_thread` status/outcome vocabulary; `channel-ops-threads.ts` and
  `channel-render-threads.ts` lose status and outcome; `channel-closed-thread.test.ts` is
  rewritten down to what survives (INVARIANTS §14 — a mixed test file whose feature is
  deleted is rewritten, never removed). **Add the retired words to
  `channel-law.test.ts › REMOVED_VOCABULARY`** — that guard parses every non-test
  `channel-*.ts` with the TypeScript compiler API and has no allowlist, so legitimate
  English that collides gets rephrased.
- Desktop: `main/session-close-task.js` and the close paths in `session-window.js`; the
  agent's `propose_close` teaching in `main/prompt-framing-text.js › VOCABULARY`.
  Annotate every surviving mention as history or
  `dopl-desktop-app/test/removed-vocabulary.test.mjs` fails — which is the point.

**Does NOT die.** The `status` COLUMN and its CHECK constraint stay for now (existing rows
carry `closed`; dropping the column is a migration behind a desktop-floor raise, INVARIANTS
§13). The read simply stops caring. Note in INVARIANTS that the column is legacy and
unread, with the date.

**INVARIANTS.** §5 loses a large slice: CLOSE IS PROPOSE-THEN-CONFIRM, FIRST CLOSE WINS,
the echo-degrades-to-null rule, both-transitions-echo, the stale-sweep clock bullet. §10
loses the close/propose ops from the MCP surface description. §13 if the cron count moves.
**This is the phase most likely to leave INVARIANTS lying** — budget the doc edit as real
work, re-verified against the tree.

**Gates.** GREEN. Plus `npx knip` (config present at `knip.json`) to prove no orphan module
survived, and `node scripts/check-doc-refs.mjs` to catch every `path › symbol` anchor in
INVARIANTS/ENGINEERING that pointed at a deleted symbol.

---

## Phase 5 — Session cards and pills die; the Agents tab and agent view arrive

**Size: L.**

**Goal.** The operator watches their own agents in a panel, not in the transcript. Pause /
end live on the AGENT.

**Deletes.**
- `components/session-card.tsx`, `session-card-status.tsx`, `session-pills-bar.tsx`,
  `thread-party.tsx`, `threads-button.tsx`, `thread-panel.tsx` and their tests;
  `apps/desktop-ui/src/features/channels/session-pills-bar.test.tsx`.
- The `lib/group-thread*.ts` family — grouping, draft, markers-that-remain-unread, render,
  types, and eight test files. This is the machinery that turned lifecycle rows into cards;
  with lifecycle out of the transcript there is nothing to group.
- ⚠ **Installed desktops keep posting `task_started` / `task_finished` / `task_failed`**
  (`main/session-window.js`'s lifecycle echoes → `channel-post.postTaskEvent`). The new
  transcript must render them as NOTHING and say so in a comment; the server-side refusal
  of the kinds cannot be tightened until the desktop floor is raised (INVARIANTS §13).
  Deleting the echoes from the desktop is part of this phase; deleting the server's
  acceptance of them is NOT.

**Builds.**
- `agents-tab.tsx` + `agent-panel.tsx` ported. Data source is LOCAL RUNTIME STATE, per
  MAPPING — `spa-bridge.ts › DesktopSessionSummary` over
  `sessions.summaries` / `sessions.onSummaries`, widened with the context/token numbers the
  mock draws. Those numbers already exist inside the desktop:
  `main/session-model.js › promptTokens` / `› contextEvent` compute them for the session
  window; `main/session-summary.js › liveSummary` / `› endedSummary` is where they join the
  wire.
- ⚠ **THREE PLACES MUST STAY IN SYNC** for that widening, and the file says so:
  `src/shared/lib/spa-bridge.ts › DesktopSessionSummary`,
  `dopl-desktop-app/renderer/app-preload.js`, `apps/desktop-ui/src/lib/dopl-bridge.ts`.
  Adding an OP (pause/end) additionally fails `test/preload-parity.test.mjs` on purpose —
  that is a **four-file change plus the pin** (INVARIANTS §11).
- Pause/end is **own-agents-only**. A peer's paused agent renders as inactive/offline
  presence, never as "thread stalled" (MAPPING ruling). Presence already fails safe: the 90 s
  window is client-side arithmetic over `lastSeenAt`, so stale reads offline (INVARIANTS §7).

**INVARIANTS.** §11 (the preload inventory grows — every add gets looked at, which is why
the pin fails on ADD), §5 (the "exactly ONE session, never write 'agent session'" copy rule
now has a surface that could break it — the agent view is where the temptation lives).

**Gates.** GREEN. Plus `test/preload-parity.test.mjs` updated deliberately, with the
main-process handler verified to exist before the list is edited.

---

## Phase 6 — Mentions: addressing, the Tags inbox, and read-state

**Size: L.** Wholly new; nothing like it exists in the tree (`grep -rn "mention"
src/features/channels/` finds only the retired agent-handle vocabulary, measured 2026-08-18).

**Goal.** A message that @-tags the operator is findable, countable and readable-once.

**Design decisions this phase must make explicitly:**

1. **Where the mention set comes from.** Server-side resolution at insert, from the body
   against the channel roster, stamped into a reserved metadata key — stripped from caller
   input and re-stamped only from the validated resolution, at the one point
   `service-writes-metadata.ts › resolvePostMetadata`. Rationale: `authorKind` and every
   other addressing claim already work this way, and a caller-settable mention list is a
   notification-forgery primitive. The alternative — an explicit MCP argument — is worse on
   its own terms (INVARIANTS §10: an unknown tool argument is refused by name, so a mistyped
   one narrates success over an invisible delivery failure).
2. **Read-state storage.** MAPPING is explicit that there is no backing column. Two shapes:
   a per-(user, channel) cursor column on `channel_members`, or a row-per-read table. The
   mock marks individual mentions read out of order, which a cursor cannot express — so the
   table, unless Samuel accepts cursor semantics. ⚠ **If it lands on `channel_members` it is
   a NEW per-member setting: add it to the DTO scrub AND leave it out of that migration's
   `GRANT` list — two edits, and the second is the one that binds (INVARIANTS §2).**
   Either way it is a published-table change → INVARIANTS §7 and §12 apply before the
   migration is written.
3. **The badge is LIVE UNREAD**, and it is a count the client can compute from the mention
   set plus read-state — no second server derivation.

**Files/symbols.** `service-writes-metadata.ts › resolvePostMetadata`; a new
`channels/lib/mentions.ts` (one parser, shared by the composer's highlight and the server's
resolution — a second copy is how the two disagree about what counts as a tag); the ported
`mentions-list.tsx › MentionsList` and the Tags disclosure in `info-panel.tsx › InfoTab`;
the nonced scroll signal from `message-pane.tsx › ScrollTarget` (keep the nonce — the
comment explaining why is correct).

**INVARIANTS.** §5 (the reserved-metadata list grows by one key — and that list LIVES IN
CODE, so the doc must point at the `delete metadata.*` run, not restate it), §2 (the
column-privilege rule if read-state lands on `channel_members`), §7 + §12 (publication /
replica identity if a new table is added: a subscriber on an unpublished table is worse
than an error).

**Gates.** GREEN. Plus: a test that a caller-supplied mention key is STRIPPED, driven
through `resolvePostMetadata` rather than asserted by regex over source (INVARIANTS §14 —
a regex over source text is not a behavioural assertion). Plus `supabase db reset` → exit 0
if a migration lands (INVARIANTS §12: replay is the gate; `migration list` is claims only).

---

## Phase 7 — Notification policy: mention-gated

**Size: M.** Desktop. Depends on Phase 6 for the stamped mention set.

**Goal.** Agent/thread activity notifies only when the agent explicitly @-tags the operator.
Applies to human DMs too.

**Files/symbols.** `dopl-desktop-app/main/targeting.js › classify` (the `fyi` verdict
becomes conditional on the stamped mention set containing me — read it the way `to_user_id`
is read, as a server-stamped, unspoofable key), `main/trigger.js › sendFyi`,
`main/task-notify.js › notifyTaskReply`, `main/listener-messages.js`'s dispatch.

**Retires.** Per-message desktop notifications. `sendFyi` either dies or narrows to the
mention case — decide which; if it narrows, its docblock's F-170 story about `myNotifyScope`
must be preserved as history, not deleted.

⚠ **Do NOT reinstate any part of `myNotifyScope`.** The docblock in `sendFyi` is emphatic
and INVARIANTS §5 agrees: two of its three options did not do what their labels said. A
quiet-in-one-channel feature is a *new design*, not a revival.

⚠ `classify` is sliced verbatim by four harnesses. Any new predicate must be a free variable
or module-scope-free, exactly as `isChatIntent` is (its own comment explains why the constant
lives inside the function).

**INVARIANTS.** §11 (notification policy is desktop session rules territory), §5 (the
classify verdict table changes shape).

**Gates.** GREEN. Plus the 1536-case truth table in `test/classify.test.mjs` regenerated,
with the mutation-verify count stated.

**Ship order.** Web (Phase 6's stamping) must be LIVE before this desktop build ships —
INVARIANTS §13, one-way gate. An old desktop against the new server simply keeps notifying
as it does today, which is the safe direction.

---

## Phase 8 — Launch settings replace the consent card

**Size: M.** Mostly composition; the controls already exist.

**Goal.** The addressee sees **Launch agent**, not Allow. Clicking expands the panel into
launch settings — permission bypass, tool use, message-sending permissions, working folder
— then launches.

**Reuses, does not rebuild.** `components/permission-preset-row.tsx › RequestPermissionRow`
(the two axes, with the copy carried verbatim from the desktop's own posture lines),
`hooks/use-channel-permission-preset.ts`, `hooks/use-channel-folder.ts`,
`components/channel-folder-control.tsx`. Per Phase 0 these ARE wired in the SPA.

**Retires.** `components/consent-card.tsx` + `consent-card.test.tsx`, and the Allow/Deny
copy. The consent ROW, its TTL, the CAS decision, the de-dupe key and
`consent-service.ts › revalidateAutoAllow` are **untouched** — the authorization model is
the same, only the surface changed. MAPPING says the launch panel "fully replaces the
consent card, including its desktop-only rows", and that is a UI statement, not an
authorization one.

⚠ **`POST /trust` / `DELETE /trust` stay `sessionOnly` and stay unreferenced by the new
panel** — trust auto-launch is ON HOLD (see *Risks*). Leave the seam; build nothing into it.

⚠ **The permission preset is an ARM, not a setting.** Single use, expiring, one consumer.
The heading is *"For the next request you allow"*, never *"this channel"* (INVARIANTS §11).
A "launch settings" panel is exactly the surface that will drift into presenting it as a
stored preference — write the rule into the component's docblock.

**Consent inbox** moves to the sidebar "Inbox" nav row (MAPPING ruling). The badge already
exists in `app-shell.tsx › AppShellLayout` on the shared cache key.

**INVARIANTS.** §6 (the surface changed, the model did not — say exactly that, so a future
reader does not conclude consent was replaced), §11 (the arm's presentation rule).

**Gates.** GREEN. Plus `src/shared/auth/write-gate-coverage.test.ts` re-run — it is one of
the executable authorities over the three auth gate sets.

---

## Phase 9 — Windowing inverts: notification click focuses the app

**Size: M.** Depends on Phase 8 (there must be somewhere to land).

**Goal.** A request notification focuses the main app and navigates to the channel/DM where
the request was made, to launch or decline there. The per-thread window stops being the
default.

**Files/symbols.**
- `main/targeting-window.js › openChannelForEntry` → `main/shell-mode.js ›
  navigateToChannels` already does *show window + navigate to `/${segment}/channels`*. The
  gap is the CHANNEL, not the mechanism.
- `main/deep-link-target.js › WORKSPACE_PAGES` — `channels: false` today, meaning no
  `:param` detail child, meaning a deep link cannot name a channel. Flipping it to `true`
  requires a matching `channels/:channelId` row in `apps/desktop-ui/src/routes.tsx`, and
  `test/deep-link-target.test.mjs` re-reads `routes.tsx` and fails on drift — which is the
  guard working, not an obstacle.
- ⚠ **The segment walk is over the RAW path string, never `parsed.pathname`** — `new URL`
  normalizes `..` away rather than refusing it. Handing that walk a pre-normalized path
  silently disarms it (INVARIANTS §11). A new segment does not change the rule; it enlarges
  the surface the rule protects.
- `main/trigger.js › handleTrigger` and `main/session-consent.js` stop opening a pre-consent
  window as the default path.

**Retires.** The per-thread session window as the default. Its machinery stays for Phase 10
and for the operator's own runs — this phase changes the DEFAULT, not the capability.

**INVARIANTS.** §11 (the deep-link table and the hand-copy rule), §13 (a desktop build that
needs the SPA's new route ships after the SPA does — the SPA rides in the same app bundle
here, so the gate is about the release, not the server; state which).

**Gates.** GREEN. Plus `test/deep-link-target.test.mjs` and `test/preload-parity.test.mjs`.

---

## Phase 10 — The pop-out thread window, opt-in

**Size: L.** The riskiest desktop phase. Do not fold it into Phase 9.

**Goal.** Each opened thread view gets an "open as new window" button — a movable pop-out
that shows the THREAD (not the session).

⚠ **The blocking constraint, found while planning:** every renderer-reachable
`ipcMain.handle` is bound to the MAIN window's `webContents` and its top frame —
`main/ui-bridge.js`'s guard and `main/channel-dir-ipc.js › isMainWindowSender`, both
fail-closed with a refusal shaped like an invalid payload so a hostile page learns nothing.
**A second SPA window would therefore have every `apiRequest` refused and would render
nothing while reporting nothing** — precisely the silent-feature-deletion failure mode
INVARIANTS §11 describes for the preload. Two ways out, and the phase must pick one on the
record:

- **(a) Widen the binding** from "the main window" to "a registry of app-owned windows".
  This is a security change to a fail-closed guard that exists because a cross-origin iframe
  shares its host's `webContents`. It needs its own review and its own test that enumerates
  the bound senders rather than trusting a memory of them.
- **(b) Reuse the session-window renderer** (`main/session-window.js ›
  createSessionWindow`, `loadFile` only, dedicated preload, `setWindowOpenHandler` deny,
  navigation locked to `file://`). Cheaper and already contained, but it is a different
  renderer from the SPA, so the thread view would be built twice.

The plan's recommendation is **(a)**, done deliberately, because building the thread view
twice is exactly the duplication this port exists to remove — but it is Samuel's call and it
is a security decision, not a convenience one.

**INVARIANTS.** §11 (the sender-binding rule changes, or is explicitly reaffirmed with a
second window carved out; either way it must be stated), §14 (the enumerating test).

**Gates.** GREEN. Plus a test that an unbound sender is still refused, and that the refusal
shape is unchanged.

---

## Phase 11 — The agent-facing surface: sparse channel posts, and tagging

**Size: M.** Depends on Phase 6 (tagging must mean something server-side first).

**Goal.** Agents learn two capabilities: they MAY post to the main channel, sparsely and
relevance-gated; and they SHOULD @-tag the operator for the important things — a needed
decision, a summary, "I'm blocked" — because most thread traffic is agents talking to each
other.

**Files/symbols.** `packages/mcp-server/src/tools/channel-description.ts ›
CHANNEL_DESCRIPTION` (THE LAW block stays FIRST and stays SHORT —
`channel-law.test.ts` pins its load-bearing sentences), `channel-post-guidance.ts` /
`channel-post-notes.ts`, and the desktop's own
`main/prompt-framing-text.js › VOCABULARY` for spawned sessions.

⚠ **A tool RESULT teaches harder than a description** — it is read by the same model at the
moment it decides what to do next (INVARIANTS §10). Guidance that only lives in the
description will be outvoted by result prose.

⚠ Every op name must appear as a quoted `"op_name"`; the parity test greps for exactly that.

**INVARIANTS.** §10 (the description's contract changes; the removed-vocabulary guard gains
entries from Phase 4 and must not gain a legitimate-English false positive — there is no
allowlist, so collisions get rephrased).

**Gates.** GREEN. Plus `npm test -w @dopl/mcp-server` including `channel-law.test.ts` and
the parity split-scan, and `npm run build:packages` — `packages/*/dist` is what the app
loads at runtime.

---

## Phase 12 — Cutover and demolition

**Size: M.**

**Goal.** `channels-v2` becomes `channels`. Nothing v2-shaped remains.

**Deletes.** `apps/desktop-ui/src/pages/channels-v2/` in full (including `MAPPING.md`,
whose rulings have by then moved into INVARIANTS and ENGINEERING); the `channels-v2` rows in
`apps/desktop-ui/src/routes.tsx › WORKSPACE_PAGES`,
`dopl-desktop-app/main/deep-link-target.js › WORKSPACE_PAGES` and the temporary NAV row in
`src/shared/layout/app-shell/app-sidebar-core.tsx`; the old `components/channel-pane.tsx`,
`channels-list-pane.tsx`, `rooms-sidebar.tsx`, `channel-transcript.tsx`,
`message-composer.tsx`, `channels-view-core.tsx` and their tests, once nothing imports them.

**Kept deliberately:** `channels-onboarding-core.tsx` (MAPPING: keep for now, redesign
later), the channel-management dialogs, `channel-folder-control.tsx` (folders ride along).

**Gates.** GREEN. Plus `npx knip`, plus `node scripts/check-doc-refs.mjs` (every anchor into
a deleted file resolves or the doc is wrong), plus the size-check job.

---

## Dependency graph

```
P0 truth-up ──┬─────────────────────────────────────────────────────┐
              │                                                     │
              ├─> P1 read model ──> P2 shell ──┬─> P3 fan-out ──┐   │
              │                                │                │   │
              │                                ├─> P4 close ────┤   │
              │                                │   retirement   │   │
              │                                ├─> P5 agents ───┤   │
              │                                │   tab/view     │   │
              │                                └─> P6 mentions ─┤   │
              │                                     │           │   │
              │                                     ├─> P7 notif│   │
              │                                     └─> P11 MCP │   │
              └─> P8 launch settings ──> P9 windowing ──> P10 pop-out
                                                                │   │
                                                                └───┴─> P12 cutover
```

**Parallelizable after P2:** P3, P4, P5 and P6 touch mostly disjoint files. The one real
collision is the transcript component (P3 adds the thread card, P4 removes the session card,
P5 removes lifecycle rendering) — sequence those three edits or land them in one branch.

**P8 does not need P2** — the launch panel can ship against the OLD page first, which is the
lower-risk order: it exercises the reused controls before the new shell is load-bearing.

**P7 needs P6 deployed, not merely merged** (the mention key must be stamped by a live
server). **P10 needs its security decision before it needs any code.**

---

## Risks & open questions

1. **Trust / auto-launch is ON HOLD** (Samuel, 2026-08-18). "Auto-launch with saved settings
   for this person" is right in principle and unbuilt by decision. Leave the seam: the
   consent row's `auto_allowed` path and `consent-service.ts › revalidateAutoAllow` keep
   working exactly as they do; the launch panel must not read or write trust, and must not
   present the permission arm as a stored preference. **Revisit before wiring.**
2. **Pop-out windows vs. the fail-closed IPC sender binding** (Phase 10). A second SPA window
   gets every privileged call refused, silently. Decide (a) widen the binding or (b) reuse
   the session renderer, on the record, before any pop-out work starts.
3. **How threads age out of the sidebar is OPEN** and Phase 1 forces the answer, because the
   read needs a bound regardless (INVARIANTS §9: a read at its ceiling counts as clipped, and
   a cap that renders identically to an exhausted list is the bug).
4. **Lifecycle echoes from installed desktops outlive the retirement.** `task_started` /
   `task_finished` / `task_failed` will keep arriving from old builds after Phase 5. The new
   transcript must render them as nothing; the server's acceptance of them cannot tighten
   until the floor is raised (INVARIANTS §13).
5. **Agent context/token numbers are runtime-only.** The server stores none of them. If the
   Agents tab must survive an app restart or show anything about a peer, that is a new
   projection — and MAPPING is explicit that it is the operator's own runtime, not a table.
6. **`channel_tasks.status` becomes a column nothing reads.** Dropping it is a migration
   behind a desktop-floor raise. Leaving it is fine; leaving it *undocumented* is how a
   future reader concludes threads still close.
7. **`declined` / `session_ended` outlive `calmTerminalStatus`.** They stay RESERVED because
   the strip is what keeps them unforgeable — a caller able to set one could attribute a calm
   ending to somebody's agent. Do not "clean up" the strip list when the readers go.
8. **Four `main/` files sat at exactly 500 lines and two at 499 on 2026-08-11** (INVARIANTS
   §11 — re-measure, do not quote). The desktop phases have no headroom; every one of them is
   a split before it is a feature.
9. **RESOLVED (Samuel, 2026-08-18): the heatmap, Linked threads, Favorites, and the
   Assistant / Drafts / Saved-items nav rows STAY AS HARDCODED UI** through the port —
   wired later as their own work. Keep the mock furniture rendering exactly as designed;
   never render zeros from missing backing data, and mark each with a
   `// HARDCODED — no backing data yet` comment so nothing mistakes it for wired.
10. **The Files tab was removed from the mock and where files land is an OPEN QUESTION.**
    Nothing in this plan answers it, and nothing here says files stop existing.

---

## MAPPING-vs-code contradictions found (raise, do not resolve)

**F-199 — the SPA is not realtime-dark; three docblocks say it is.**
`shared-channel-registry.ts › subscribeSharedWorkspaceTables` routes to
`› subscribeViaBridge` whenever the bridge exposes `onSyncEvent` + `syncWatch`;
`renderer/app-preload.js` exposes both, `test/preload-parity.test.mjs › APP_OPS` pins them,
and every channels table is in `main/ui-sync.js › SYNC_TABLES`. The claim lives in
`apps/desktop-ui/src/pages/channels/index.tsx › ChannelsPage`,
`apps/desktop-ui/src/components/app-shell/app-shell.tsx › AppShellLayout`, and is inherited
by MAPPING.md § *Not represented in the mock* ("realtime (OFF in the SPA — polling/refetch
only, see `pages/channels/index.tsx` docblock)"). Measured 2026-08-18: the docblock landed in
`1f614c1a`, the bridge path in `90201de5` **26 minutes later**, and nobody went back.
INVARIANTS §7 was never wrong — only the page docblocks are.

**F-200 — the consent card's desktop rows are wired, and the same docblock says they are
not.** `renderer/app-preload.js` exposes `channels.getFolderLabel` / `chooseFolder` /
`clearFolder` / `getPermissionPreset` / `setPermissionPreset`; `preload-parity.test.mjs`
names `channels.chooseFolder` as "the consent card's folder row" in its
already-shipped-a-silent-bug list. Added in `24862c76`, **~3 minutes after** the docblock
that denies it. Consequence for the plan: Phase 8 is composition, not construction.

**Third, not a code contradiction but a MAPPING internal one worth raising.** MAPPING's
Threads-tab section describes the Active/Inactive filter and the calm-flag card subline as
port-time work; its third-round ruling then retires the filter entirely ("threads never
leave… activity ordering replaces it") and Phase 4 retires the calm-flag terminal reads the
subline would have colored. Both earlier passages are dead intent. They should be struck when
MAPPING's rulings migrate into INVARIANTS, not carried forward as two live specs.

**Fourth, a shape MAPPING draws that storage cannot hold as-drawn.** "One card, N addressees"
plus `channel_tasks`' partial unique index on `(channel_id, client_msg_id)` means a naive
fan-out reusing one `clientMsgId` converges rows 2..N onto row 1 via `service-tasks.ts ›
convergeOnThread` and the request reaches exactly one person — succeeding silently, which is
the worst available failure. Phase 3 names the per-addressee key and the test that pins it.

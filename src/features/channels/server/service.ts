import "server-only";

/**
 * Service layer for the channels feature — the public surface. REST
 * handlers call into this. Implementation lives in per-domain siblings so
 * each file has one clear purpose; cross-cutting context + gates live in
 * `service-shared.ts`.
 *   - `service-shared.ts`  — context, visibility gate, management gate, resolvers
 *   - `service-reads.ts`   — list + header + roster + tasks + cursor reads + await
 *                            poll + the named-agent ATTRIBUTION roster
 *   - `service-await.ts`   — the await long-poll HOLD loop (tick + recheck cadence)
 *   - `service-writes.ts`  — create (incl. direct) / update / delete, post message
 *   - `service-writes-members.ts` — channel membership (add / remove / own prefs)
 *   - `service-writes-metadata.ts` — what a post may put in `metadata` vs. what
 *                            the server stamps (addressing, task keys, the
 *                            fan-out group)
 *   - `service-tasks.ts`   — first-class task lifecycle (create / set mode)
 *   - `consent-service.ts` — OUTBOUND review requests (v1.2). ⚠ The INBOUND lane
 *                            was retired 2026-08-22 with `trust-service.ts`,
 *                            `POST|DELETE /api/channels/trust` and the
 *                            `agent_trust_rules` table.
 *   - `presence-service.ts`— desktop heartbeat upsert (v1.2)
 *
 * GONE in the channels rollback (§1, 2026-08-05): `service-agents.ts`,
 * `service-participants.ts`, `service-thread-handshake.ts` and
 * `service-writes-agents.ts`. Survivors: the attribution roster read moved into
 * `service-reads.ts`, `assertChatIsUnaddressed` into `service-writes.ts`.
 */

export { buildChannelContext } from "./service-shared";
// ⚠ `loadVisibleChannel` IS ON THE BARREL AS OF 2026-08-26 AND IT IS THE ONLY
// GATE THAT IS. The channel KNOWLEDGE lane
// (`src/app/api/channels/[channelId]/knowledge/**`) has no channels-feature
// payload to ask for and §3.3 forbids knowledge importing this feature, so the
// composition happens at the route layer and the fence must be nameable there.
// ⚠ Its `membership: null` return is NOT a refusal — see its own docblock. The
// lane requires membership explicitly.
export { loadVisibleChannel } from "./service-shared";
// ⚠ `ChannelContext` / `AuthLike` were dropped from the barrel (2026-08-20): no
// outside caller took them, and a barrel row with no importer is a second name
// for a type, which is how two of them drift.

export {
  listChannels,
  getChannel,
  listAgents,
  listChannelMembers,
  listChannelTasks,
  getChannelTask,
  readMessages,
  // THE FOLDED READ (2026-09-06, artifacts #1220 §4) — the ROUTE's read: page
  // plus its folded rendering, over the same body as `readMessages`, so there is
  // still ONE cursor read and ONE watermark rule. ⚠ `readEntries` sat beside it
  // and is DELETED (2026-09-06) — a barrel row was its only reference.
  readTranscript,
  resolveReadableChannelId,
} from "./service-reads";
// THE ARTIFACT WRITES + the single-card read (design #1220 §5). ⚠ On the barrel
// because the artifact ROUTE and the MCP surface are outside this directory;
// `foldPage` / `foldEntries` / `readNamesMessages` are NOT — a handler reaching
// for the fold would be deciding the addressing pin a second time.
export {
  createArtifact,
  addToArtifact,
  removeFromArtifact,
  dissolveArtifact,
  readArtifact,
  ArtifactNotFoundError,
} from "./service-artifacts";
// THE BROWSE READ (Samuel, 2026-09-16) — the same route's GET with no
// `?artifact=`. ⚠ ITS OWN MODULE because `service-artifacts.ts` is at the §1 cap;
// that file's docblock carries the seam, and the function's carries why the
// design's "not offered" line gave way.
export { listChannelArtifacts } from "./service-artifacts-list";
// `revalidateAwaitAccess` / `pollChannelMessages` / `hasNewMessages` are NOT
// re-exported: `service-await.ts` imports them directly, and a second name for a
// long-poll internal only invites a handler to call one.

// THE MENTIONS INBOX (wiring plan Phase 6). Its own module because it is the
// only channels read scoped to the CALLER rather than to the channel, and its
// read-state store (`channel_mention_reads`) has no other reader.
export { listMyChannelMentions, markMentionsRead } from "./service-mentions";

export { awaitNewMessages } from "./service-await";
// ⚠ `AwaitHoldCounters` STAYS — `api/channels/[channelId]/await/route.ts` really
// takes it through this barrel. `AwaitHoldResult` did not and is dropped.
export type { AwaitHoldCounters } from "./service-await";

// THE WORKSPACE-WIDE HOLD (2026-08-22) — `op="await"` with no `channel`, across
// every channel the caller is a MEMBER of. ⚠ Its own module, NOT a mode on
// `awaitNewMessages`: the two holds have different fences (a resolved channel id
// vs. a re-proved membership set) and collapsing them would put two
// authorization stories behind one signature.
export { awaitWorkspaceMessages } from "./service-await-workspace";
export type {
  WorkspaceAwaitCounters,
  WorkspaceChannelMessage,
} from "./service-await-workspace";

export {
  createChannel,
  updateChannel,
  deleteChannel,
  postMessage,
} from "./service-writes";

export {
  addMember,
  removeMember,
  updateMyMemberSettings,
} from "./service-writes-members";

// C-20's sweep half (2026-08-10). NOT A HANDLER SURFACE — the one exception to
// this barrel's opening line. It takes no `ChannelContext` and authorizes
// nothing; its only legitimate caller is `workspaces/server/membership-admin`,
// server-to-server, after the workspace removal committed. Wiring it to a route
// or an MCP op would publish an unauthenticated "evict this user from every room
// in the workspace" primitive. The DM decision is in the module docblock.
export { removeWorkspaceDepartedMember } from "./service-workspace-departure";

export { createTask, setTaskMode } from "./service-tasks";

// THE REQUEST FAN-OUT (wiring plan Phase 3): N addressees, N threads, one card.
// Its own module because it is a CALLER of `createTask` and nothing else — the
// per-addressee idempotency key and the derived group id get "simplified" out of
// a create.
export { createTaskFanOut } from "./service-tasks-broadcast";

// THREAD DELETION (Samuel, 2026-08-21) — HARD, cascading, creator-or-manager,
// and NOT a finished state: a thread that exists is still live, this is how one
// stops existing. Its own module because it is a five-table cascade with an
// ordering argument, where `service-tasks.ts` is create + set-mode. ⚠ Reachable
// ONLY from `DELETE /api/channels/[channelId]/tasks/[taskId]`, which is
// `sessionOnly` — there is no MCP op and there must not be one.
export { deleteTask } from "./service-tasks-delete";

// THREADS NO LONGER CLOSE (wiring plan Phase 4, 2026-08-18). `service-tasks-
// lifecycle.ts` and `service-tasks-propose.ts` are DELETED with the only writes
// that moved `channel_tasks.status`; the column survives carrying legacy `closed`
// rows that nothing reads. The operator pauses or ends an AGENT, not a thread.

export {
  createConsentRequest,
  listConsentRequests,
  getConsentRequest,
  decideConsentRequest,
} from "./consent-service";

export {
  heartbeatPresence,
  heartbeatPresenceEverywhere,
} from "./presence-service";

export {
  listSessionStates,
  reportSessionStates,
} from "./session-state-service";

// THE WAKE ACK (2026-09-02, A9) — what a machine DID with a message, riding the
// session-health push beside the projection it already sends. Its own module
// because it writes `channel_messages`, which the session projection never
// touches: one file, one reason to change.
export { recordDeliveryAcks } from "./service-writes-delivery";

// TOKEN SPEND (2026-09-06, Samuel #1326) — the DURABLE copy of the lifetime
// token figure, riding the same session push. Its own module because
// `channel_sessions` is a live projection deleted when the pill leaves and this
// outlives it.
export { readTokenSpend, recordSessionTokenSpend } from "./service-token-spend";
export type {
  TokenSpendMarkPoint,
  TokenSpendReport,
} from "./service-token-spend";

// LAUNCH-OVER-MCP (Samuel, 2026-08-22) — an operator's external agent asking
// that operator's OWN desktop to start an agent. ⚠ Its own module because it is
// the one channel write that produces NO MESSAGE: a directive stays off
// `channel_messages` on purpose (INVARIANTS §5 — the loop brake, and transcript
// purity), so none of the post-path machinery applies to it and none of it
// should be reachable from here.
export {
  createLaunchDirective,
  getLaunchDirective,
  listPendingLaunchDirectives,
  claimLaunchDirective,
  decideLaunchDirective,
  LAUNCH_REFUSAL_REASONS,
} from "./service-launch";

// AGENT MANAGEMENT OVER MCP (Samuel, 2026-09-01) — the SAME mailbox, two more
// KINDS. ⚠ A separate module and NOT a separate lane: `end` and `rename` are
// `channel_launch_directives` rows with `kind <> 'launch'`, so every fence, the
// claim CAS, lazy expiry and the refusal vocabulary are the launch lane's. The
// split buys one place to argue the CONSENT DIFFERENCE — the launch toggle gates
// `launch` and gates neither of these.
export {
  createAgentDirective,
} from "./service-launch-agent";
export type {
  CreateAgentDirectiveInput,
  CreateAgentDirectiveResult,
} from "./service-launch-agent";

// THE PRIVATE DIRECT LANE (2026-08-31) — the launch mailbox's sibling, and off
// `channel_messages` for the same two reasons plus a third: the lane is PRIVATE BY
// DEFINITION, so the shared transcript is not a trade-off but the feature's
// negation. None of the post-path machinery applies to it either.
export {
  createAgentDirection,
  getAgentDirection,
  listPendingAgentDirections,
  listRecentAgentDirections,
  claimAgentDirection,
  decideAgentDirection,
  DIRECTION_REFUSAL_REASONS,
} from "./service-directions";

// THE ACCOUNT-WIDE READS (2026-09-01, T20/T21/T22) — one answer across every
// workspace AND every home-channel container the caller belongs to.
//
// ⚠ USER-SCOPED, NOT WORKSPACE-SCOPED — hence a separate module rather than a
// flag on `listChannels` / `awaitWorkspaceMessages`, which take a
// `ChannelContext` naming ONE workspace. The fence is `channel_members.user_id`
// alone (see `service-account.ts`'s header); the CONTAINER LOCK is applied by
// the MCP layer, not by these.
export { getAccountStatus, readAccountMessages } from "./service-account";
export type {
  AccountChannelMessage,
  AccountChannelStatus,
  AccountMessagesPage,
  AccountStatus,
  AccountStatusClips,
  AccountStatusOptions,
  AccountStatusView,
  AccountWaitingItem,
} from "./service-account";

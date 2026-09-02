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
 *   - `consent-service.ts` — OUTBOUND review requests (v1.2). ⚠ It carried the
 *                            INBOUND lane too until 2026-08-22; that half is
 *                            retired, and `trust-service.ts` — per-teammate
 *                            standing consent, which existed only to auto-allow
 *                            an inbound request — is DELETED with it, along with
 *                            `POST|DELETE /api/channels/trust` and the
 *                            `agent_trust_rules` table.
 *   - `presence-service.ts`— desktop heartbeat upsert (v1.2)
 *
 * GONE in the channels rollback (§1, 2026-08-05): `service-agents.ts` (summon /
 * rename / status / disengage), `service-participants.ts` (breakout membership),
 * `service-thread-handshake.ts` (the two-agent thread derivation) and
 * `service-writes-agents.ts` (agent addressing + engagement). What survived each
 * of them: the attribution roster read moved into `service-reads.ts`, and
 * `assertChatIsUnaddressed` moved into `service-writes.ts`.
 */

export { buildChannelContext } from "./service-shared";
// ⚠ `loadVisibleChannel` IS ON THE BARREL AS OF 2026-08-26 AND IT IS THE ONLY
// GATE THAT IS. Every other handler reaches it indirectly, through a read or a
// write that composes it — but the channel KNOWLEDGE lane
// (`src/app/api/channels/[channelId]/knowledge/**`) has no channels-feature
// payload to ask for: its payload is knowledge's, and §3.3 forbids the knowledge
// service importing this feature. So the composition happens at the route layer,
// and the fence it composes has to be nameable from outside this directory.
// ⚠ Its `membership: null` return is NOT a refusal — see its own docblock. The
// lane requires membership explicitly.
export { loadVisibleChannel } from "./service-shared";
// ⚠ `ChannelContext` / `AuthLike` were re-exported here and are NOT (2026-08-20):
// no caller outside this directory ever took them through the barrel, and the ones
// inside import from `./service-shared` directly. A barrel row with no importer is
// a second name for a type, which is how two of them drift.

export {
  listChannels,
  getChannel,
  listAgents,
  listChannelMembers,
  listChannelTasks,
  getChannelTask,
  readMessages,
  resolveReadableChannelId,
} from "./service-reads";
// `revalidateAwaitAccess` / `pollChannelMessages` / `hasNewMessages` are NOT re-exported.
// Their one consumer is `service-await.ts`, which imports them from `./service-reads`
// directly; a second name for a long-poll internal only invites a handler to call one.

// THE MENTIONS INBOX (wiring plan Phase 6). Its own module because it is the
// only channels read scoped to the CALLER rather than to the channel — the
// projection can answer for `ctx.userId` and for nobody else — and because its
// read-state store (`channel_mention_reads`) has no other reader.
export { listMyChannelMentions, markMentionsRead } from "./service-mentions";

export { awaitNewMessages } from "./service-await";
// ⚠ `AwaitHoldCounters` STAYS — `api/channels/[channelId]/await/route.ts` really
// takes it through this barrel. `AwaitHoldResult` did not and is dropped.
export type { AwaitHoldCounters } from "./service-await";

// THE WORKSPACE-WIDE HOLD (2026-08-22) — `op="await"` with no `channel`, across
// every channel the caller is a MEMBER of. ⚠ Its own module, and NOT a mode on
// `awaitNewMessages`: the two holds have different fences (a resolved channel id
// vs. a re-proved membership set) and collapsing them would put two
// authorization stories behind one signature. See its docblock for how the M2
// access invariant is preserved on a path with no channel to resolve.
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
// server-to-server, once the workspace removal has already committed. Wiring it
// to a route or an MCP op would publish an unauthenticated "evict this user
// from every room in the workspace" primitive. The module docblock carries the
// DM decision (close the pair, don't strand the survivor) and why.
export { removeWorkspaceDepartedMember } from "./service-workspace-departure";

export { createTask, setTaskMode } from "./service-tasks";

// THE REQUEST FAN-OUT (wiring plan Phase 3): N addressees, N threads, one card.
// Its own module because it is a CALLER of `createTask` and nothing else — the
// per-addressee idempotency key and the derived group id are the whole content,
// and both are the kind of rule that gets "simplified" out of a create.
export { createTaskFanOut } from "./service-tasks-broadcast";

// THREAD DELETION (Samuel, 2026-08-21) — HARD, cascading, creator-or-manager,
// and NOT a finished state: a thread that exists is still live, this is how one
// stops existing. Its own module because it is a five-table cascade with an
// ordering argument, where `service-tasks.ts` is create + set-mode. ⚠ Reachable
// ONLY from `DELETE /api/channels/[channelId]/tasks/[taskId]`, which is
// `sessionOnly` — there is no MCP op and there must not be one.
export { deleteTask } from "./service-tasks-delete";

// THREADS NO LONGER CLOSE (wiring plan Phase 4, 2026-08-18). `service-tasks-
// lifecycle.ts` (closeTask / reopenTask) and `service-tasks-propose.ts`
// (proposeTaskClose) are DELETED, and with them the only writes that ever moved
// `channel_tasks.status`. The column and its CHECK survive carrying legacy
// `closed` rows; nothing reads them. The operator pauses or ends an AGENT, not a
// thread.

export {
  createConsentRequest,
  listConsentRequests,
  getConsentRequest,
  decideConsentRequest,
} from "./consent-service";

export { heartbeatPresence } from "./presence-service";

export {
  listSessionStates,
  reportSessionStates,
} from "./session-state-service";

// THE WAKE ACK (2026-09-02, A9) — what a machine DID with a message, riding the
// session-health push beside the projection it already sends. Its own module
// because it writes `channel_messages`, which the session projection never
// touches: one file, one reason to change.
export { recordDeliveryAcks } from "./service-writes-delivery";

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
// claim CAS, lazy expiry and the refusal vocabulary are the launch lane's,
// unchanged. What the split buys is that the CONSENT DIFFERENCE — the launch
// toggle gates `launch` and gates neither of these — is argued in one place
// instead of as a branch inside a function about starting processes.
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
// ⚠ USER-SCOPED, NOT WORKSPACE-SCOPED, and that is why they are a separate
// module rather than a flag on `listChannels` / `awaitWorkspaceMessages`: those
// take a `ChannelContext`, which names ONE workspace, and threading an absent
// workspace through them would put two authorization stories behind one
// signature. The fence is `channel_members.user_id` alone — see
// `service-account.ts`'s header, and note that the CONTAINER LOCK is applied by
// the MCP layer rather than by these.
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
/*
 * THE "NEEDS YOU" SIGNAL (2026-09-01) — one agent telling exactly ONE recipient
 * that it is done, has a question, or is blocked.
 *
 * ⚠ OFF `channel_messages`, so NONE OF THE POST-PATH MACHINERY APPLIES and none
 * of it should be reachable from here: no reserved-metadata seam, no addressing
 * fan-out, no mention resolution, no idempotency key, no transcript. The three
 * reasons are the migration header's — a ping must not fan out to the room, it
 * must not end a channel `await` (it has no `channel_messages.seq` and can never
 * consume that cursor), and it needs its own cursor space, which `since=` on
 * both reads below is.
 *
 * ⚠ THE HOLD IS ITS OWN MODULE and is NOT a mode on either message await: those
 * two are fenced by a resolved channel id and by a re-proved membership set, and
 * this one by `recipient_user_id = ctx.userId`. Three fences, three functions —
 * see `service-pings-await.ts` for why that also makes its loop short.
 */
export { createPing, listPings } from "./service-pings";
export { awaitPings } from "./service-pings-await";
export type { PingAwaitCounters } from "./service-pings-await";

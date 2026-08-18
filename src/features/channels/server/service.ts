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
 *   - `service-tasks-lifecycle.ts` — the two status transitions (close / reopen),
 *                            each guarded against a double-apply and each echoed
 *                            into the transcript (`channel_tasks` is in no
 *                            realtime table set, so the echo IS the doorbell)
 *   - `consent-service.ts` — inbound consent + outbound review requests (v1.2)
 *   - `trust-service.ts`   — per-teammate standing consent rules (v1.2)
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
export type { ChannelContext, AuthLike } from "./service-shared";

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
export type { AwaitHoldCounters, AwaitHoldResult } from "./service-await";

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
export type { DepartedMemberSweep } from "./service-workspace-departure";

export { createTask, setTaskMode } from "./service-tasks";
export type { TaskCreateOptions, TaskCreateResult } from "./service-tasks";

// THE REQUEST FAN-OUT (wiring plan Phase 3): N addressees, N threads, one card.
// Its own module because it is a CALLER of `createTask` and nothing else — the
// per-addressee idempotency key and the derived group id are the whole content,
// and both are the kind of rule that gets "simplified" out of a create.
export { createTaskFanOut } from "./service-tasks-fanout";
export type { TaskFanOutResult } from "./service-tasks-fanout";

// C-26 / C-30 (2026-08-08): CLOSE and REOPEN are the only two writes that move a
// thread's `status`, and they now share one shape — guard the transition
// atomically, echo it into the transcript, degrade to `echoSeq: null` if the echo
// is lost. Their own module because that shape is the reason they change.
export { closeTask, reopenTask } from "./service-tasks-lifecycle";
export type {
  TaskCloseResult,
  TaskReopenResult,
} from "./service-tasks-lifecycle";

// DECISION 2 (2026-08-04): an agent PROPOSES, a human CLOSES. Its own module
// because the two acts have different authorities over one shared thread.
export { proposeTaskClose } from "./service-tasks-propose";

export {
  createConsentRequest,
  listConsentRequests,
  getConsentRequest,
  decideConsentRequest,
} from "./consent-service";

export {
  listTrustRules,
  createTrustRule,
  deleteTrustRule,
} from "./trust-service";

export { heartbeatPresence } from "./presence-service";

export {
  listSessionStates,
  reportSessionStates,
} from "./session-state-service";

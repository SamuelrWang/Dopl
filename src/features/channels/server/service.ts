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
 *                            the server stamps (addressing, DM auto-address, task keys)
 *   - `service-tasks.ts`   — first-class task lifecycle (create / close / mode / reopen)
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

export {
  createTask,
  closeTask,
  setTaskMode,
  reopenTask,
} from "./service-tasks";

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

export { listSessionStates } from "./session-state-service";

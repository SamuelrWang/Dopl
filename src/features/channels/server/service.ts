import "server-only";

/**
 * Service layer for the channels feature — the public surface. REST
 * handlers call into this. Implementation lives in per-domain siblings so
 * each file has one clear purpose; cross-cutting context + gates live in
 * `service-shared.ts`.
 *   - `service-shared.ts`  — context, visibility gate, management gate, resolvers
 *   - `service-reads.ts`   — list + header + roster + tasks + cursor reads + await poll
 *   - `service-await.ts`   — the await long-poll HOLD loop (tick + recheck cadence)
 *   - `service-writes.ts`  — create (incl. direct) / update / delete, post message, members
 *   - `service-writes-metadata.ts` — what a post may put in `metadata` vs. what
 *                            the server stamps (addressing, DM auto-address, task keys)
 *   - `service-tasks.ts`   — first-class task lifecycle (create / close / mode / reopen)
 *   - `consent-service.ts` — inbound consent + outbound review requests (v1.2)
 *   - `trust-service.ts`   — per-teammate standing consent rules (v1.2)
 *   - `presence-service.ts`— desktop heartbeat upsert (v1.2)
 */

export { buildChannelContext } from "./service-shared";
export type { ChannelContext, AuthLike } from "./service-shared";

export {
  listChannels,
  getChannel,
  listChannelMembers,
  listChannelTasks,
  getChannelTask,
  readMessages,
  resolveReadableChannelId,
  revalidateAwaitAccess,
  pollChannelMessages,
  hasNewMessages,
} from "./service-reads";

export { awaitNewMessages } from "./service-await";
export type { AwaitHoldCounters, AwaitHoldResult } from "./service-await";

export {
  createChannel,
  updateChannel,
  deleteChannel,
  postMessage,
  addMember,
  removeMember,
  updateMyMemberSettings,
} from "./service-writes";

export {
  createTask,
  closeTask,
  setTaskMode,
  reopenTask,
} from "./service-tasks";

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

import "server-only";

/**
 * Service layer for the channels feature — the public surface. REST
 * handlers call into this. Implementation lives in per-domain siblings so
 * each file has one clear purpose; cross-cutting context + gates live in
 * `service-shared.ts`.
 *   - `service-shared.ts`  — context, visibility gate, management gate, resolvers
 *   - `service-reads.ts`   — list + header + roster + tasks + cursor reads + await poll
 *   - `service-writes.ts`  — create (incl. direct) / update / delete, post message, members, tasks
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
} from "./service-reads";

export {
  createChannel,
  updateChannel,
  deleteChannel,
  postMessage,
  addMember,
  removeMember,
  updateMyMemberSettings,
  createTask,
  closeTask,
  setTaskMode,
  reopenTask,
} from "./service-writes";

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

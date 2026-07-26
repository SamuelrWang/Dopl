import "server-only";

/**
 * Service layer for the channels feature — the public surface. REST
 * handlers call into this. Implementation lives in per-domain siblings so
 * each file has one clear purpose; cross-cutting context + gates live in
 * `service-shared.ts`.
 *   - `service-shared.ts`  — context, visibility gate, management gate, resolvers
 *   - `service-reads.ts`   — list + header + roster + cursor message reads + await poll
 *   - `service-writes.ts`  — create / update / delete, post message, add / remove member
 */

export { buildChannelContext } from "./service-shared";
export type { ChannelContext, AuthLike } from "./service-shared";

export {
  listChannels,
  getChannel,
  listChannelMembers,
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
  updateMyNotifyScope,
} from "./service-writes";

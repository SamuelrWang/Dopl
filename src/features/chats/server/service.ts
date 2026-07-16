import "server-only";

/**
 * Service layer for the chats feature — the public surface. REST handlers
 * and the server-rendered chats page both call into this. The service
 * builds a `ChatContext` from auth metadata, enforces M-10 + team-scope
 * visibility, and keeps folder-filed chats' sharing in sync with their
 * folder.
 *
 * This module is a barrel: the implementation lives in per-domain
 * siblings so each file has one clear purpose. Cross-cutting gates and
 * helpers used by more than one domain live in `service-shared.ts`.
 *   - `service-shared.ts`  — context, visibility gates, ownership guard, folder inheritance, format/profile helpers
 *   - `service-reads.ts`   — list + single-chat detail reads
 *   - `service-writes.ts`  — export (create / re-export) + owner-only mutations
 *   - `service-folders.ts` — folder CRUD + scope propagation
 */

export { buildChatContext } from "./service-shared";
export type { ChatContext, AuthLike } from "./service-shared";

export { listChats, getChat } from "./service-reads";

export {
  exportChat,
  appendMessages,
  updateChatHeader,
  deleteChat,
} from "./service-writes";

export {
  listFolders,
  createFolder,
  updateFolderForUser,
  deleteFolderForUser,
} from "./service-folders";

import "server-only";

/**
 * Public chats service surface — REST handlers and the server-rendered chats
 * page both call in. Builds `ChatContext` from auth metadata, enforces
 * visibility, keeps folder-filed chats' sharing in sync with their folder.
 * ⚠ DELETES ARE PERMANENT — no trash, restore or purge. `deleted_at` and the
 * read-path `deleted_at IS NULL` filters stay only to keep pre-switch
 * tombstones hidden until the cleanup migration sweeps them.
 *
 * Barrel over per-domain siblings; cross-cutting gates live in
 * `service-shared.ts`.
 *   - `service-shared.ts`  — context, visibility gates, ownership guard, folder inheritance
 *   - `service-reads.ts`   — list + detail reads
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

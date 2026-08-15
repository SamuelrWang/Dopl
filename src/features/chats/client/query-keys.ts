import { apiResource, type ApiResourceKeys } from "@/shared/api/query-keys";

/**
 * Chats URLs + the cache keys built from them, in one place, so a write and
 * the read it patches can't disagree. ⚠ Never retype a key at a call site.
 * Optimistic writes patch by PREFIX (`.all`), reaching every mounted variant.
 * ⚠ Keys are paths, so scoping is per chat id by construction: no prefix
 * reaches two transcripts and `["/api/chats"]` cannot reach
 * `["/api/chats/folders"]` (TanStack matches per ARRAY ELEMENT). A hand-typed
 * `["chat-detail", workspaceId]` re-opens the workspace-wide invalidation that
 * stampedes every cached transcript.
 */

export const CHATS_PATH = "/api/chats";
export const CHAT_FOLDERS_PATH = "/api/chats/folders";

/** One chat: its transcript read AND its PATCH/DELETE target. */
export function chatPath(chatId: string): string {
  return `${CHATS_PATH}/${encodeURIComponent(chatId)}`;
}

export function chatFolderPath(folderId: string): string {
  return `${CHAT_FOLDERS_PATH}/${encodeURIComponent(folderId)}`;
}

export const chatKeys = {
  /** Workspace chat list — `{ chats, hiddenCount }`. */
  list: (): ApiResourceKeys => apiResource(CHATS_PATH),
  /** Caller's folders — `{ folders }`. */
  folders: (): ApiResourceKeys => apiResource(CHAT_FOLDERS_PATH),
  /** One chat's full document — `{ chat }`, transcript included. */
  detail: (chatId: string): ApiResourceKeys => apiResource(chatPath(chatId)),
};

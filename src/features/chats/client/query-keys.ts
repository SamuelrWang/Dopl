import { apiResource, type ApiResourceKeys } from "@/shared/api/query-keys";

/**
 * The chats feature's URLs and the cache keys built from them, in one place —
 * so a write and the read it patches can never disagree about either.
 *
 * `client/api.ts` builds its request paths from the builders below and
 * `client/hooks.ts` reads through `useApiQuery`'s `[path, workspaceId, query]`
 * tuple, so a key is never retyped at a call site. Optimistic writes patch by
 * the PREFIX key (`.all`), which reaches every workspace / query variant a
 * reader may have mounted without the writer having to enumerate them.
 *
 * SCOPED BY CHAT ID BY CONSTRUCTION, and that is the whole fix for the
 * transcript stampede. The archive's per-chat read used to register a
 * hand-typed `["chat-detail", workspaceId, chatId]`, whose two-element prefix
 * `["chat-detail", workspaceId]` was the only handle a writer had — so the one
 * realtime signal that meant "some chat changed" invalidated EVERY cached
 * transcript in the workspace. Keyed by path, each transcript's key is
 * `["/api/chats/<id>"]` and there is no prefix that reaches two of them: the
 * broadest thing a writer can say is the name of the chat it touched.
 * `["/api/chats"]` likewise cannot reach `["/api/chats/folders"]` or any
 * transcript, because TanStack matches keys per ARRAY ELEMENT, not by string
 * prefix.
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
  /** The workspace chat list — `{ chats, hiddenCount }`. */
  list: (): ApiResourceKeys => apiResource(CHATS_PATH),
  /** The caller's folders — `{ folders }`. */
  folders: (): ApiResourceKeys => apiResource(CHAT_FOLDERS_PATH),
  /** One chat's full document — `{ chat }`, transcript included. */
  detail: (chatId: string): ApiResourceKeys => apiResource(chatPath(chatId)),
};

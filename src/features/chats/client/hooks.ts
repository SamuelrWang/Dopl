"use client";

import { useCallback } from "react";
import { useApiQuery } from "@/shared/hooks/use-api-query";
import type { ChatDetail, ChatFolder } from "../types";
import type {
  ChatDetailCache,
  ChatFoldersCache,
  ChatListCache,
} from "../lib/optimistic-cache";
import { CHAT_FOLDERS_PATH, CHATS_PATH, chatPath } from "./query-keys";

export type ChatDetailStatus = "idle" | "loading" | "success" | "error";

const selectChat = (body: ChatDetailCache): ChatDetail => body.chat;
const selectFolders = (body: ChatFoldersCache): ChatFolder[] =>
  body.folders ?? [];

/**
 * ⚠ All three reads must stay on `useApiQuery` — it registers the
 * `[path, workspaceId, query]` tuple `@/shared/api/query-keys` rebuilds for
 * the write side, so writes patch the exact entry. Hand-typed keys break
 * patching and widen invalidation to every transcript in the workspace.
 */

export function useChats(workspaceId: string) {
  return useApiQuery<ChatListCache>(CHATS_PATH, { workspaceId });
}

export function useChatFolders(workspaceId: string) {
  return useApiQuery<ChatFoldersCache, ChatFolder[]>(CHAT_FOLDERS_PATH, {
    workspaceId,
    select: selectFolders,
  });
}

/** Full transcript for the selected chat. Header data lives in the list read
 *  (single source for toggles); this owns only the messages payload. */
export function useChatDetail(
  chatId: string | null,
  workspaceId: string
): { detail: ChatDetail | null; status: ChatDetailStatus; retry: () => void } {
  const query = useApiQuery<ChatDetailCache, ChatDetail>(
    chatId === null ? null : chatPath(chatId),
    { workspaceId, select: selectChat }
  );

  // ⚠ Data wins over error: a failed background refetch must not blank a
  // rendered transcript into the error card.
  const status: ChatDetailStatus = !chatId
    ? "idle"
    : query.data !== undefined
      ? "success"
      : query.error
        ? "error"
        : "loading";

  const rawRefetch = query.refetch;
  const retry = useCallback(() => {
    void rawRefetch();
  }, [rawRefetch]);

  return { detail: query.data ?? null, status, retry };
}

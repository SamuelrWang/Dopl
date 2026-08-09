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
 * The archive's three reads, all on `useApiQuery` — which is what makes them
 * PATCHABLE. Every one of them registers the `[path, workspaceId, query]`
 * tuple `@/shared/api/query-keys` rebuilds for the write side, so a mutation
 * can edit exactly the entry a component is subscribed to.
 *
 * `useChatDetail` used to call `useQuery` with a hand-typed
 * `["chat-detail", workspaceId, chatId]`. Two costs, both real: the writes
 * had no factory to reach it through (so they refetched instead of patching),
 * and its two-element prefix was a workspace-wide handle — one realtime signal
 * invalidated every transcript the user had ever opened. Keyed by path, the
 * broadest thing any writer can name is one chat.
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

/**
 * Loads the full transcript for the selected chat. Header data lives in the
 * list read (single source for the toggles); this hook only owns the messages
 * payload. The key scopes per chat, so a stale transcript never renders under
 * a different header — and revisiting a chat serves from cache. `retry()`
 * re-runs the fetch.
 */
export function useChatDetail(
  chatId: string | null,
  workspaceId: string
): { detail: ChatDetail | null; status: ChatDetailStatus; retry: () => void } {
  const query = useApiQuery<ChatDetailCache, ChatDetail>(
    chatId === null ? null : chatPath(chatId),
    { workspaceId, select: selectChat }
  );

  // Data wins over error: a failed background refetch must not blank a
  // rendered transcript into the error card.
  const status: ChatDetailStatus = !chatId
    ? "idle"
    : query.data !== undefined
      ? "success"
      : query.error
        ? "error"
        : "loading";

  // `useApiQuery`'s refetch already no-ops on a disabled (null-path) query.
  const rawRefetch = query.refetch;
  const retry = useCallback(() => {
    void rawRefetch();
  }, [rawRefetch]);

  return { detail: query.data ?? null, status, retry };
}

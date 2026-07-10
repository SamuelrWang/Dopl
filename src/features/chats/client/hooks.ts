"use client";

import { useCallback } from "react";
import { useQuery } from "@tanstack/react-query";
import type { ChatDetail } from "../types";
import { fetchChat } from "./api";

export type ChatDetailStatus = "idle" | "loading" | "success" | "error";

/**
 * Loads the full transcript for the selected chat via TanStack Query.
 * Header data lives in the list state (single source for toggles); this
 * hook only owns the messages payload. The key scopes per chat, so a
 * stale transcript never renders under a different header — and
 * revisiting a chat serves from cache. `retry()` re-runs the fetch.
 */
export function useChatDetail(
  chatId: string | null,
  workspaceId: string
): { detail: ChatDetail | null; status: ChatDetailStatus; retry: () => void } {
  const query = useQuery({
    queryKey: ["chat-detail", workspaceId, chatId],
    queryFn: () => fetchChat(chatId as string, workspaceId),
    enabled: chatId !== null,
  });

  // Data wins over error: a failed background refetch must not blank a
  // rendered transcript into the error card.
  const status: ChatDetailStatus = !chatId
    ? "idle"
    : query.data !== undefined
      ? "success"
      : query.error
        ? "error"
        : "loading";

  // v5 refetch() ignores `enabled`; no-op while no chat is selected.
  const rawRefetch = query.refetch;
  const retry = useCallback(() => {
    if (chatId !== null) void rawRefetch();
  }, [chatId, rawRefetch]);

  return {
    detail: query.data ?? null,
    status,
    retry,
  };
}

"use client";

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

  const status: ChatDetailStatus = !chatId
    ? "idle"
    : query.error
      ? "error"
      : query.data !== undefined
        ? "success"
        : "loading";

  return {
    detail: query.data ?? null,
    status,
    retry: query.refetch,
  };
}

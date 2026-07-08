"use client";

import { useCallback, useEffect, useState } from "react";
import type { ChatDetail } from "../types";
import { fetchChat } from "./api";

export type ChatDetailStatus = "idle" | "loading" | "success" | "error";

/**
 * Loads the full transcript for the selected chat. Header data lives in
 * the list state (single source for toggles); this hook only owns the
 * messages payload. State resets via render-time key adjustment (the
 * sanctioned "adjust state during render" pattern, same as the skills
 * client hooks) so a stale transcript never renders under a different
 * header. `retry()` re-runs the fetch for the current chat.
 */
export function useChatDetail(
  chatId: string | null,
  workspaceId: string
): { detail: ChatDetail | null; status: ChatDetailStatus; retry: () => void } {
  const [detail, setDetail] = useState<ChatDetail | null>(null);
  const [status, setStatus] = useState<ChatDetailStatus>(
    chatId ? "loading" : "idle"
  );
  const [lastId, setLastId] = useState(chatId);
  const [attempt, setAttempt] = useState(0);

  if (lastId !== chatId) {
    setLastId(chatId);
    setDetail(null);
    setStatus(chatId ? "loading" : "idle");
  }

  useEffect(() => {
    if (!chatId) return;
    let cancelled = false;
    fetchChat(chatId, workspaceId)
      .then((chat) => {
        if (cancelled) return;
        setDetail(chat);
        setStatus("success");
      })
      .catch(() => {
        if (cancelled) return;
        setStatus("error");
      });
    return () => {
      cancelled = true;
    };
  }, [chatId, workspaceId, attempt]);

  const retry = useCallback(() => {
    setDetail(null);
    setStatus("loading");
    setAttempt((n) => n + 1);
  }, []);

  return { detail, status, retry };
}

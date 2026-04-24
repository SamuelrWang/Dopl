"use client";

/**
 * useChatName — assign a deterministic title to a chat panel after the
 * first user message lands.
 *
 * The previous implementation POSTed the message history to
 * `/api/chat/name` which ran a server-side Claude call to generate a
 * topic label. That route has been retired as part of the
 * client-only-LLM pivot. This hook now derives the title locally from
 * the first user message (truncated). A connected MCP agent can
 * rename the chat at any time via the `rename_chat` MCP tool if a
 * better title emerges mid-conversation.
 */

import { useEffect, useRef } from "react";
import { useCanvas } from "@/features/canvas/canvas-store";
import type { ChatPanelData } from "@/features/canvas/types";

const PLACEHOLDER_PATTERN = /^(Chat\s*#\d+|New Chat)$/i;
const MAX_TITLE_CHARS = 40;

function deriveChatTitle(panel: ChatPanelData): string | null {
  const firstUserTextMsg = panel.messages.find(
    (m) => m.role === "user" && m.type === "text"
  );
  if (!firstUserTextMsg || !firstUserTextMsg.content) return null;

  // Collapse whitespace, strip leading markdown/prompt prefixes that
  // usually aren't part of a good title.
  const cleaned = firstUserTextMsg.content
    .replace(/\s+/g, " ")
    .replace(/^[>#*\-\s]+/, "")
    .trim();

  if (!cleaned) return null;
  if (cleaned.length <= MAX_TITLE_CHARS) return cleaned;
  return cleaned.slice(0, MAX_TITLE_CHARS - 1).trimEnd() + "…";
}

export function useChatName(panel: ChatPanelData) {
  const { dispatch } = useCanvas();
  const attemptedRef = useRef(false);

  useEffect(() => {
    if (attemptedRef.current) return;
    if (!PLACEHOLDER_PATTERN.test(panel.title)) return;

    const hasUserMsg = panel.messages.some(
      (m) => m.role === "user" && m.type === "text"
    );
    if (!hasUserMsg) return;

    const derived = deriveChatTitle(panel);
    if (!derived) return;

    attemptedRef.current = true;
    dispatch({
      type: "UPDATE_CHAT_TITLE",
      panelId: panel.id,
      title: derived,
    });
  }, [panel.title, panel.messages, panel.id, dispatch]);
}

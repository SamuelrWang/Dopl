"use client";

/**
 * use-chat-name.ts — auto-generates a topic name for a chat panel after
 * the first AI response completes. Follows the same pattern as the cluster
 * naming hook (use-cluster-name.ts): non-blocking, fail-silent, runs once.
 */

import { useEffect, useRef } from "react";
import { useCanvas } from "../../canvas-store";
import type { ChatPanelData } from "../../types";

const PLACEHOLDER_PATTERN = /^Chat\s*#\d+$/i;

export function useChatName(panel: ChatPanelData) {
  const { dispatch } = useCanvas();
  const attemptedRef = useRef(false);

  useEffect(() => {
    if (attemptedRef.current) return;
    // Only attempt if title is still the default placeholder
    if (!PLACEHOLDER_PATTERN.test(panel.title)) return;

    // Wait until we have at least one user message + one AI text response
    const hasUserMsg = panel.messages.some(
      (m) => m.role === "user" && m.type === "text"
    );
    const hasAiResponse = panel.messages.some(
      (m) => m.role === "ai" && m.type === "text"
    );
    if (!hasUserMsg || !hasAiResponse) return;

    attemptedRef.current = true;

    // Build messages for the naming API
    const apiMessages: Array<{ role: string; content: string }> = [];
    for (const m of panel.messages) {
      if (
        (m.role === "user" && m.type === "text") ||
        (m.role === "ai" && m.type === "text")
      ) {
        apiMessages.push({
          role: m.role === "ai" ? "assistant" : "user",
          content: m.content,
        });
        if (apiMessages.length >= 4) break;
      }
    }

    fetch("/api/chat/name", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ messages: apiMessages }),
    })
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (data?.name) {
          dispatch({
            type: "UPDATE_CHAT_TITLE",
            panelId: panel.id,
            title: data.name,
          });
        }
      })
      .catch(() => {
        // Fail silently — user keeps the placeholder name
      });
  }, [panel.title, panel.messages, panel.id, dispatch]);
}

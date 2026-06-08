"use client";

/**
 * useChat — streams a user message through /api/chat and updates the
 * panel's message log as events arrive.
 *
 * Event handling mirrors the BuilderChat implementation so there's one
 * canonical SSE contract in the codebase:
 *   - text_delta: append to the current streaming bubble via
 *                 UPDATE_STREAMING_MESSAGE (in-place edit, no bloat)
 *   - tool_call: finalise any open streaming bubble, then append a
 *                tool_activity message
 *   - tool_result: append a "done" tool_activity summary
 *   - done: finalise the trailing streaming bubble
 *   - error: append a plain-text error bubble
 */

import { useCallback, useRef, useState } from "react";
import { useCanvas, useCanvasScope } from "@/features/canvas/canvas-store";
import type { ChatMessage, ChatAttachment } from "@/shared/types/chat";
import type { ChatPanelData } from "@/features/canvas/types";
import { buildCanvasContext } from "./cluster-context";
import { messagesToApiHistory } from "./chat-message-types";

interface UseChatOptions {
  panel: ChatPanelData;
}

export function useChat({ panel }: UseChatOptions) {
  const { state, dispatch } = useCanvas();
  const scope = useCanvasScope();
  const workspaceId = scope?.workspaceId ?? null;
  const [isStreaming, setIsStreaming] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  // Latest state snapshot — the SSE loop needs to read the current
  // panel/clusters map without re-creating `send` on every render.
  const stateRef = useRef(state);
  stateRef.current = state;

  const send = useCallback(
    async (input: string, attachments?: ChatAttachment[]) => {
      const text = input.trim();
      if ((!text && (!attachments || attachments.length === 0)) || isStreaming)
        return;

      // 1. Append the user message synchronously so the UI reflects it
      //    immediately (before network).
      const userMessage: ChatMessage = {
        role: "user",
        type: "text",
        content: text || " ",
        ...(attachments && attachments.length > 0 ? { attachments } : {}),
      };
      dispatch({
        type: "APPEND_MESSAGE",
        panelId: panel.id,
        message: userMessage,
      });

      setIsStreaming(true);

      // 2. Build history + cluster context from a stable state snapshot.
      const latestPanel = stateRef.current.panels.find(
        (p) => p.id === panel.id && p.type === "chat"
      );
      const latestMessages: ChatMessage[] =
        latestPanel && latestPanel.type === "chat"
          ? latestPanel.messages
          : [];
      const history = messagesToApiHistory([...latestMessages, userMessage]);
      const canvasContext = buildCanvasContext(panel.id, stateRef.current);

      const controller = new AbortController();
      abortRef.current = controller;

      // 3. Kick off the request and parse the SSE stream.
      let streamingText = "";
      let streamingActive = false;

      function ensureStreamingBubble() {
        streamingActive = true;
        dispatch({
          type: "UPDATE_STREAMING_MESSAGE",
          panelId: panel.id,
          content: streamingText,
        });
      }
      function finaliseBubble() {
        if (!streamingActive) return;
        dispatch({
          type: "FINALISE_STREAMING_MESSAGE",
          panelId: panel.id,
          content: streamingText,
        });
        streamingActive = false;
        streamingText = "";
      }

      try {
        const headers: Record<string, string> = {
          "Content-Type": "application/json",
        };
        if (workspaceId) headers["X-Workspace-Id"] = workspaceId;
        const response = await fetch("/api/chat", {
          method: "POST",
          headers,
          body: JSON.stringify({
            messages: history,
            canvasContext,
          }),
          signal: controller.signal,
        });

        if (!response.ok) {
          const err = await response.json().catch(() => ({}));
          if (response.status === 402 && err.error === "trial_expired") {
            // Trial ended or never started — the root-mounted PaywallGate
            // will pick this up on its next poll and show the modal. We
            // still surface a short notice inline so the user sees why
            // their request didn't go through.
            dispatch({
              type: "APPEND_MESSAGE",
              panelId: panel.id,
              message: {
                role: "ai",
                type: "trial_expired",
                message:
                  err.message ||
                  "Your free trial has ended. Subscribe for $7.99/mo to continue.",
              },
            });
            return;
          }
          throw new Error(err.error || `HTTP ${response.status}`);
        }

        const reader = response.body?.getReader();
        if (!reader) throw new Error("No response stream");

        const decoder = new TextDecoder();
        let buffer = "";

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop() || "";

          for (const line of lines) {
            if (!line.startsWith("data: ")) continue;
            const jsonStr = line.slice(6).trim();
            if (!jsonStr) continue;
            let event: {
              type: string;
              content?: string;
              name?: string;
              summary?: string;
              message?: string;
            };
            try {
              event = JSON.parse(jsonStr);
            } catch {
              continue;
            }

            switch (event.type) {
              case "text_delta": {
                streamingText += event.content || "";
                ensureStreamingBubble();
                break;
              }
              case "tool_call": {
                finaliseBubble();
                dispatch({
                  type: "APPEND_MESSAGE",
                  panelId: panel.id,
                  message: {
                    role: "ai",
                    type: "tool_activity",
                    toolName: event.name || "tool",
                    status: "calling",
                  },
                });
                break;
              }
              case "tool_result": {
                dispatch({
                  type: "APPEND_MESSAGE",
                  panelId: panel.id,
                  message: {
                    role: "ai",
                    type: "tool_activity",
                    toolName: event.name || "tool",
                    status: "done",
                    summary: event.summary,
                  },
                });
                // A fresh streaming bubble will be created lazily on the
                // next text_delta — no need to prep it empty.
                break;
              }
              case "done": {
                finaliseBubble();
                break;
              }
              case "error": {
                finaliseBubble();
                dispatch({
                  type: "APPEND_MESSAGE",
                  panelId: panel.id,
                  message: {
                    role: "ai",
                    type: "text",
                    content: `Something went wrong: ${event.message || "Unknown error"}`,
                  },
                });
                break;
              }
            }
          }
        }

        // Stream ended without an explicit done event (defensive).
        finaliseBubble();
      } catch (err) {
        if ((err as Error).name !== "AbortError") {
          finaliseBubble();
          dispatch({
            type: "APPEND_MESSAGE",
            panelId: panel.id,
            message: {
              role: "ai",
              type: "text",
              content: `Failed to reach chat: ${err instanceof Error ? err.message : "Unknown error"}`,
            },
          });
        }
      } finally {
        abortRef.current = null;
        setIsStreaming(false);
      }
    },
    [dispatch, isStreaming, panel.id]
  );

  const cancel = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    setIsStreaming(false);
  }, []);

  return { send, cancel, isStreaming };
}

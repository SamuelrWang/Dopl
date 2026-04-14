/**
 * Tab-scoped chat hook — ephemeral conversations per browser tab.
 * Messages are stored in chrome.storage.session and auto-cleared on tab close.
 */

import { useState, useEffect, useCallback, useRef } from "react";
import { useBgMessage } from "./useBgMessage";
import type { ChatMessage } from "@/shared/types";

export function useTabChat() {
  const { send } = useBgMessage();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [isStreaming, setIsStreaming] = useState(false);
  const abortRef = useRef<(() => void) | null>(null);

  // Load existing messages on mount
  useEffect(() => {
    send<ChatMessage[]>({ type: "GET_TAB_CHAT" })
      .then(setMessages)
      .catch(() => {});
  }, [send]);

  // Persist messages when they change
  useEffect(() => {
    if (messages.length > 0) {
      send({ type: "SAVE_TAB_CHAT", messages }).catch(() => {});
    }
  }, [messages, send]);

  const sendMessage = useCallback(
    async (input: string, pageContext?: string) => {
      const text = input.trim();
      if (!text || isStreaming) return;

      // Add user message
      const userMsg: ChatMessage = { role: "user", type: "text", content: text };
      setMessages((prev) => [...prev, userMsg]);
      setIsStreaming(true);

      // Build API message history
      const history = [...messages, userMsg]
        .filter((m) => m.type === "text" || m.type === "streaming")
        .map((m) => ({ role: m.role, content: "content" in m ? m.content : "" }));

      // Build canvas context (include page content if available)
      const canvasContext = pageContext
        ? { entries: [{ title: "Current Page", content: pageContext }] }
        : undefined;

      let streamingText = "";
      let streamingActive = false;

      try {
        // Import api-client dynamically to avoid bundling in panel
        const auth = await send<{ apiUrl: string; apiKey?: string; mode: string }>({
          type: "GET_AUTH_STATE",
        });

        const headers: Record<string, string> = { "Content-Type": "application/json" };
        if (auth.mode === "api_key" && auth.apiKey) {
          headers["Authorization"] = `Bearer ${auth.apiKey}`;
        }

        const controller = new AbortController();
        abortRef.current = () => controller.abort();

        const res = await fetch(`${auth.apiUrl}/api/chat`, {
          method: "POST",
          headers,
          body: JSON.stringify({ messages: history, canvasContext }),
          signal: controller.signal,
        });

        if (!res.ok) {
          const err = await res.json().catch(() => ({}));
          throw new Error((err as { error?: string }).error || `HTTP ${res.status}`);
        }

        const reader = res.body?.getReader();
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
            let event: { type: string; content?: string; name?: string; summary?: string; entry?: unknown; message?: string };
            try {
              event = JSON.parse(jsonStr);
            } catch {
              continue;
            }

            switch (event.type) {
              case "text_delta": {
                streamingText += event.content || "";
                streamingActive = true;
                setMessages((prev) => {
                  const last = prev[prev.length - 1];
                  if (last?.type === "streaming") {
                    return [...prev.slice(0, -1), { role: "ai" as const, type: "streaming" as const, content: streamingText }];
                  }
                  return [...prev, { role: "ai" as const, type: "streaming" as const, content: streamingText }];
                });
                break;
              }
              case "tool_call": {
                // Finalize streaming, add tool activity
                if (streamingActive) {
                  setMessages((prev) => {
                    const last = prev[prev.length - 1];
                    if (last?.type === "streaming") {
                      return [
                        ...prev.slice(0, -1),
                        { role: "ai" as const, type: "text" as const, content: streamingText },
                        { role: "ai" as const, type: "tool_activity" as const, toolName: event.name || "tool", status: "calling" as const },
                      ];
                    }
                    return [...prev, { role: "ai" as const, type: "tool_activity" as const, toolName: event.name || "tool", status: "calling" as const }];
                  });
                  streamingActive = false;
                  streamingText = "";
                } else {
                  setMessages((prev) => [
                    ...prev,
                    { role: "ai" as const, type: "tool_activity" as const, toolName: event.name || "tool", status: "calling" as const },
                  ]);
                }
                break;
              }
              case "entry_reference": {
                if (event.entry) {
                  setMessages((prev) => [
                    ...prev,
                    { role: "ai" as const, type: "entry_cards" as const, entries: [event.entry as ChatMessage extends { type: "entry_cards" } ? ChatMessage : never extends never ? never : any] },
                  ]);
                }
                break;
              }
              case "tool_result": {
                setMessages((prev) => [
                  ...prev,
                  { role: "ai" as const, type: "tool_activity" as const, toolName: event.name || "tool", status: "done" as const, summary: event.summary },
                ]);
                break;
              }
              case "done": {
                if (streamingActive) {
                  setMessages((prev) => {
                    const last = prev[prev.length - 1];
                    if (last?.type === "streaming") {
                      return [...prev.slice(0, -1), { role: "ai" as const, type: "text" as const, content: streamingText }];
                    }
                    return prev;
                  });
                  streamingActive = false;
                  streamingText = "";
                }
                break;
              }
              case "error": {
                if (streamingActive) {
                  setMessages((prev) => {
                    const last = prev[prev.length - 1];
                    if (last?.type === "streaming") {
                      return [...prev.slice(0, -1), { role: "ai" as const, type: "text" as const, content: streamingText }];
                    }
                    return prev;
                  });
                }
                setMessages((prev) => [
                  ...prev,
                  { role: "ai" as const, type: "text" as const, content: `Error: ${event.message || "Unknown error"}` },
                ]);
                break;
              }
            }
          }
        }

        // Finalize any remaining streaming
        if (streamingActive) {
          setMessages((prev) => {
            const last = prev[prev.length - 1];
            if (last?.type === "streaming") {
              return [...prev.slice(0, -1), { role: "ai" as const, type: "text" as const, content: streamingText }];
            }
            return prev;
          });
        }
      } catch (err) {
        if ((err as Error).name !== "AbortError") {
          setMessages((prev) => [
            ...prev,
            { role: "ai" as const, type: "text" as const, content: `Failed: ${err instanceof Error ? err.message : "Unknown error"}` },
          ]);
        }
      } finally {
        abortRef.current = null;
        setIsStreaming(false);
      }
    },
    [messages, isStreaming, send]
  );

  const cancel = useCallback(() => {
    abortRef.current?.();
    abortRef.current = null;
    setIsStreaming(false);
  }, []);

  const clearChat = useCallback(async () => {
    setMessages([]);
    await send({ type: "CLEAR_TAB_CHAT" }).catch(() => {});
  }, [send]);

  return { messages, isStreaming, sendMessage, cancel, clearChat };
}

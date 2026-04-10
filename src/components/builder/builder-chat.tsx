"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  BuilderMessageBubble,
  type BuilderMessage,
  type EntryReference,
} from "./builder-message";

const WELCOME_MESSAGE: BuilderMessage = {
  role: "ai",
  type: "text",
  content:
    "I can help you find and build AI/automation setups from the knowledge base. Describe what you want to build — I'll search for relevant setups and help you put together a plan.",
};

interface ChatHistoryMessage {
  role: "user" | "assistant";
  content: string;
}

export function BuilderChat() {
  const [messages, setMessages] = useState<BuilderMessage[]>([WELCOME_MESSAGE]);
  const [input, setInput] = useState("");
  const [isStreaming, setIsStreaming] = useState(false);
  const [chatHistory, setChatHistory] = useState<ChatHistoryMessage[]>([]);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const handleSend = useCallback(async () => {
    const text = input.trim();
    if (!text || isStreaming) return;

    setInput("");
    setIsStreaming(true);

    // Add user message
    setMessages((prev) => [...prev, { role: "user", type: "text", content: text }]);

    // Build message history for Claude
    const newHistory: ChatHistoryMessage[] = [
      ...chatHistory,
      { role: "user" as const, content: text },
    ];

    try {
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: newHistory.map((m) => ({
            role: m.role,
            content: m.content,
          })),
        }),
      });

      if (!response.ok) {
        const errData = await response.json();
        throw new Error(errData.error || "Chat request failed");
      }

      const reader = response.body?.getReader();
      if (!reader) throw new Error("No response stream");

      const decoder = new TextDecoder();
      let streamingText = "";
      let streamingMsgIndex: number | null = null;
      const pendingEntries: EntryReference[] = [];

      // Add initial streaming message
      setMessages((prev) => {
        streamingMsgIndex = prev.length;
        return [...prev, { role: "ai", type: "streaming", content: "" }];
      });

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

          try {
            const event = JSON.parse(jsonStr);

            switch (event.type) {
              case "text_delta": {
                streamingText += event.content;
                setMessages((prev) => {
                  const updated = [...prev];
                  if (streamingMsgIndex !== null) {
                    updated[streamingMsgIndex] = {
                      role: "ai",
                      type: "streaming",
                      content: streamingText,
                    };
                  }
                  return updated;
                });
                break;
              }

              case "tool_call": {
                // If we were streaming text, finalize it
                if (streamingText && streamingMsgIndex !== null) {
                  setMessages((prev) => {
                    const updated = [...prev];
                    updated[streamingMsgIndex!] = {
                      role: "ai",
                      type: "text",
                      content: streamingText,
                    };
                    return updated;
                  });
                  streamingText = "";
                  streamingMsgIndex = null;
                }

                // Show tool activity
                setMessages((prev) => [
                  ...prev,
                  {
                    role: "ai",
                    type: "tool_activity",
                    toolName: event.name,
                    status: "calling",
                  },
                ]);
                break;
              }

              case "entry_reference": {
                pendingEntries.push(event.entry as EntryReference);
                break;
              }

              case "tool_result": {
                // Update tool activity to done
                setMessages((prev) => {
                  const updated = [...prev];
                  const toolIdx = updated.findLastIndex(
                    (m) =>
                      m.role === "ai" &&
                      m.type === "tool_activity" &&
                      m.status === "calling"
                  );
                  if (toolIdx !== -1 && updated[toolIdx].type === "tool_activity") {
                    updated[toolIdx] = {
                      ...updated[toolIdx],
                      type: "tool_activity",
                      role: "ai",
                      toolName: (updated[toolIdx] as { toolName: string }).toolName,
                      status: "done",
                      summary: event.summary,
                    };
                  }
                  return updated;
                });

                // Show entry cards if any
                if (pendingEntries.length > 0) {
                  setMessages((prev) => [
                    ...prev,
                    {
                      role: "ai",
                      type: "entry_cards",
                      entries: [...pendingEntries],
                    },
                  ]);
                  pendingEntries.length = 0;
                }

                // Start new streaming message for post-tool response
                streamingText = "";
                setMessages((prev) => {
                  streamingMsgIndex = prev.length;
                  return [
                    ...prev,
                    { role: "ai", type: "streaming", content: "" },
                  ];
                });
                break;
              }

              case "done": {
                // Finalize any streaming text
                if (streamingMsgIndex !== null) {
                  setMessages((prev) => {
                    const updated = [...prev];
                    if (streamingText) {
                      updated[streamingMsgIndex!] = {
                        role: "ai",
                        type: "text",
                        content: streamingText,
                      };
                    } else {
                      // Remove empty streaming message
                      updated.splice(streamingMsgIndex!, 1);
                    }
                    return updated;
                  });
                }
                break;
              }

              case "error": {
                setMessages((prev) => [
                  ...prev,
                  {
                    role: "ai",
                    type: "text",
                    content: `Something went wrong: ${event.message}`,
                  },
                ]);
                break;
              }
            }
          } catch {
            // Skip malformed SSE data
          }
        }
      }

      // Update chat history with assistant response
      if (streamingText) {
        setChatHistory([
          ...newHistory,
          { role: "assistant", content: streamingText },
        ]);
      } else {
        setChatHistory(newHistory);
      }
    } catch (err) {
      setMessages((prev) => [
        ...prev,
        {
          role: "ai",
          type: "text",
          content: `Failed to get response: ${err instanceof Error ? err.message : "Unknown error"}`,
        },
      ]);
    } finally {
      setIsStreaming(false);
    }
  }, [input, isStreaming, chatHistory]);

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  }

  return (
    <div className="flex flex-col h-[calc(100vh-8rem)]">
      {/* Messages area */}
      <div
        ref={scrollRef}
        className="flex-1 overflow-y-auto px-4 py-6 space-y-4"
      >
        {messages.map((msg, i) => (
          <BuilderMessageBubble key={i} message={msg} />
        ))}
      </div>

      {/* Input area */}
      <div className="border-t bg-background p-4">
        <div className="flex gap-2 max-w-3xl mx-auto">
          <Input
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={
              isStreaming
                ? "Thinking..."
                : "Describe what you want to build..."
            }
            disabled={isStreaming}
            className="flex-1"
          />
          <Button
            onClick={handleSend}
            disabled={isStreaming || !input.trim()}
          >
            Send
          </Button>
        </div>
      </div>
    </div>
  );
}

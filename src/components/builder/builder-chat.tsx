"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  BuilderMessageBubble,
  type BuilderMessage,
  type EntryReference,
} from "./builder-message";
import { CitationPanel, type CitationDetails } from "./citation-panel";

const WELCOME_MESSAGE: BuilderMessage = {
  role: "ai",
  type: "text",
  content:
    "I can help you design and build AI/automation systems. Describe what you want to build — I'll put together a concrete implementation plan with tool recommendations, architecture decisions, and setup steps.",
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

  // Citation panel state
  const [selectedCitation, setSelectedCitation] = useState<EntryReference | null>(null);
  const [citationDetails, setCitationDetails] = useState<CitationDetails | null>(null);
  const [citationLoading, setCitationLoading] = useState(false);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  // Fetch full entry details when a citation is clicked
  const handleCitationClick = useCallback(async (entry: EntryReference) => {
    setSelectedCitation(entry);
    setCitationDetails(null);
    setCitationLoading(true);

    try {
      const res = await fetch(`/api/entries/${entry.entry_id}`);
      if (!res.ok) throw new Error("Failed to fetch");
      const data = await res.json();

      setCitationDetails({
        id: data.id,
        title: data.title,
        summary: data.summary,
        source_url: data.source_url,
        source_platform: data.source_platform,
        complexity: data.complexity,
        use_case: data.use_case,
        readme: data.readme,
        agents_md: data.agents_md,
        manifest: data.manifest,
        tags: data.tags || [],
      });
    } catch {
      setCitationDetails(null);
    } finally {
      setCitationLoading(false);
    }
  }, []);

  const handleCloseCitation = useCallback(() => {
    setSelectedCitation(null);
    setCitationDetails(null);
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

    // Track all entry references across this turn for citations
    const turnCitations = new Map<string, EntryReference>();

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
                // If we were streaming text, finalize it with citations
                if (streamingText && streamingMsgIndex !== null) {
                  const citationsSnapshot = new Map(turnCitations);
                  setMessages((prev) => {
                    const updated = [...prev];
                    updated[streamingMsgIndex!] = {
                      role: "ai",
                      type: "text",
                      content: streamingText,
                      citations: citationsSnapshot.size > 0 ? citationsSnapshot : undefined,
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
                // Accumulate into citation map — don't render as cards
                const ref = event.entry as EntryReference;
                if (ref.entry_id) {
                  turnCitations.set(ref.entry_id, ref);
                }
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
                // Finalize any streaming text — attach all accumulated citations
                if (streamingMsgIndex !== null) {
                  const finalCitations = new Map(turnCitations);
                  setMessages((prev) => {
                    const updated = [...prev];
                    if (streamingText) {
                      updated[streamingMsgIndex!] = {
                        role: "ai",
                        type: "text",
                        content: streamingText,
                        citations: finalCitations.size > 0 ? finalCitations : undefined,
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
        className="flex-1 overflow-y-auto p-6 space-y-4 min-h-0 relative"
      >
        {messages.map((msg, i) => (
          <BuilderMessageBubble
            key={i}
            message={msg}
            onCitationClick={handleCitationClick}
          />
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

      {/* Citation side panel */}
      <CitationPanel
        entry={selectedCitation}
        details={citationDetails}
        loading={citationLoading}
        onClose={handleCloseCitation}
      />
    </div>
  );
}

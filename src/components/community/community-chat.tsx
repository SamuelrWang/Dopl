"use client";

/**
 * CommunityChat — self-contained chat for the published cluster detail page.
 *
 * Sends messages to /api/chat with the published cluster's entries as context.
 * Parses the SSE stream for text_delta events. Simplified from the canvas
 * chat panel — no tool_activity rendering, no entry cards, just text Q&A.
 */

import { useState, useRef, useCallback, useEffect } from "react";
import type { PublishedClusterDetail } from "@/lib/community/types";
import type { CanvasContextPayload, ContextPanelDTO } from "@/components/canvas/panels/chat/cluster-context";
import { CONTEXT_CHAR_BUDGET_PER_FIELD } from "@/config";
import { MarkdownMessage } from "@/components/design/markdown-message";

interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

interface CommunityChatProps {
  cluster: PublishedClusterDetail;
}

function buildContextFromPublished(cluster: PublishedClusterDetail): CanvasContextPayload {
  const panels: ContextPanelDTO[] = cluster.entries
    .map((entry) => ({
      kind: "entry" as const,
      entryId: entry.entry_id,
      title: entry.title || "Untitled",
      summary: entry.summary,
      readme: (entry.readme || "").slice(0, CONTEXT_CHAR_BUDGET_PER_FIELD),
      agentsMd: (entry.agents_md || "").slice(0, CONTEXT_CHAR_BUDGET_PER_FIELD),
    }));

  return {
    scope: "cluster",
    clusterName: cluster.title,
    panels,
  };
}

export function CommunityChat({ cluster }: CommunityChatProps) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const contextRef = useRef<CanvasContextPayload | null>(null);

  // Build context once
  if (!contextRef.current) {
    contextRef.current = buildContextFromPublished(cluster);
  }

  // Auto-scroll on new messages
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages]);

  const send = useCallback(async () => {
    const text = input.trim();
    if (!text || streaming) return;
    setInput("");

    const userMsg: ChatMessage = { role: "user", content: text };
    setMessages((prev) => [...prev, userMsg]);
    setStreaming(true);

    // Build API messages from history
    const allMessages = [...messages, userMsg];
    const apiMessages = allMessages.map((m) => ({
      role: m.role === "assistant" ? "assistant" : "user",
      content: m.content,
    }));

    const controller = new AbortController();
    abortRef.current = controller;

    let streamingText = "";

    try {
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: apiMessages,
          canvasContext: contextRef.current,
        }),
        signal: controller.signal,
      });

      if (!response.ok) {
        const err = await response.json().catch(() => ({}));
        throw new Error(err.error || `HTTP ${response.status}`);
      }

      const reader = response.body?.getReader();
      if (!reader) throw new Error("No response stream");

      const decoder = new TextDecoder();
      let buffer = "";

      // Add empty assistant message to stream into
      setMessages((prev) => [...prev, { role: "assistant", content: "" }]);

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
            if (event.type === "text_delta") {
              streamingText += event.content || "";
              setMessages((prev) => {
                const next = [...prev];
                const last = next[next.length - 1];
                if (last && last.role === "assistant") {
                  next[next.length - 1] = { ...last, content: streamingText };
                }
                return next;
              });
            } else if (event.type === "error") {
              streamingText += `\n\nError: ${event.message || "Unknown error"}`;
              setMessages((prev) => {
                const next = [...prev];
                const last = next[next.length - 1];
                if (last && last.role === "assistant") {
                  next[next.length - 1] = { ...last, content: streamingText };
                }
                return next;
              });
            }
            // We ignore tool_call, tool_result, entry_reference, done for simplicity
          } catch {
            continue;
          }
        }
      }
    } catch (err) {
      if ((err as Error).name !== "AbortError") {
        setMessages((prev) => [
          ...prev.filter((m) => !(m.role === "assistant" && m.content === "")),
          { role: "assistant", content: `Failed: ${err instanceof Error ? err.message : "Unknown error"}` },
        ]);
      }
    } finally {
      abortRef.current = null;
      setStreaming(false);
    }
  }, [input, streaming, messages, cluster]);

  return (
    <div className="flex flex-col h-full">
      {/* Messages */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-3 space-y-3">
        {messages.length === 0 && (
          <div className="text-center py-8">
            <p className="text-white/25 text-xs">
              Ask anything about this cluster
            </p>
          </div>
        )}
        {messages.map((msg, i) => (
          <div key={i} className="text-sm leading-relaxed">
            <span className="text-[10px] font-mono uppercase tracking-wider text-white/20 block mb-0.5">
              {msg.role === "user" ? "You" : "AI"}
            </span>
            {msg.role === "user" ? (
              <div className="whitespace-pre-wrap text-white/70">{msg.content}</div>
            ) : (
              <MarkdownMessage content={msg.content} />
            )}
          </div>
        ))}
        {streaming && messages[messages.length - 1]?.content === "" && (
          <div className="text-xs text-white/20 animate-pulse">Thinking...</div>
        )}
      </div>

      {/* Input */}
      <div className="flex-shrink-0 border-t border-white/[0.06] p-3">
        <div className="flex gap-2">
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                send();
              }
            }}
            placeholder="Ask about this cluster..."
            disabled={streaming}
            className="flex-1 h-8 px-3 rounded-md bg-white/[0.04] border border-white/[0.08] text-sm text-white placeholder:text-white/20 outline-none focus:border-white/[0.15] transition-colors disabled:opacity-50"
          />
          <button
            onClick={send}
            disabled={streaming || !input.trim()}
            className="h-8 px-3 rounded-md bg-white/[0.08] text-xs text-white/60 hover:text-white hover:bg-white/[0.12] disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
          >
            Send
          </button>
        </div>
      </div>
    </div>
  );
}

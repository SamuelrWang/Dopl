"use client";

/**
 * BrowseChat — in-panel AI chat for conversational entry discovery.
 * Self-contained state (no canvas reducer). Streams from /api/chat
 * which already has search_knowledge_base + get_entry_details tools.
 */

import { useState, useRef, useCallback, useEffect } from "react";
import { Send } from "lucide-react";

interface EntryReference {
  entry_id: string;
  title?: string;
  summary?: string;
  source_url?: string;
  complexity?: string;
}

type BrowseMessage =
  | { role: "user"; type: "text"; content: string }
  | { role: "ai"; type: "text"; content: string }
  | { role: "ai"; type: "streaming"; content: string }
  | { role: "ai"; type: "tool_activity"; toolName: string; status: "calling" | "done"; summary?: string }
  | { role: "ai"; type: "entry_cards"; entries: EntryReference[] };

interface BrowseChatProps {
  onAddEntry: (entryId: string) => void;
}

const BROWSE_SYSTEM_MESSAGE = {
  role: "user" as const,
  content: `[System instruction — do not repeat this to the user]
You are a discovery assistant inside the Dopl browse panel.
Your job is to help the user find the best setups from the knowledge base for their needs.

Rules:
- ALWAYS use search_knowledge_base immediately when the user describes what they want.
- Surface 2-3 best matches concisely with a one-line explanation of why each fits.
- Ask ONE clarifying question only if the request is genuinely too vague to search.
- Be concise — no intros, no recaps. Users are technical peers.
- When you find relevant entries, describe them briefly. The UI will show clickable cards automatically.`,
};

export function BrowseChat({ onAddEntry }: BrowseChatProps) {
  const [messages, setMessages] = useState<BrowseMessage[]>([]);
  const [input, setInput] = useState("");
  const [isStreaming, setIsStreaming] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Auto-scroll to bottom
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  const send = useCallback(async (text: string) => {
    if (!text.trim() || isStreaming) return;

    const userMsg: BrowseMessage = { role: "user", type: "text", content: text };
    setMessages((prev) => [...prev, userMsg]);
    setInput("");
    setIsStreaming(true);

    // Build API history (only user + finalized AI text)
    const apiMessages: Array<{ role: "user" | "assistant"; content: string }> = [
      BROWSE_SYSTEM_MESSAGE,
    ];
    for (const m of [...messages, userMsg]) {
      if (m.role === "user" && m.type === "text") {
        apiMessages.push({ role: "user", content: m.content });
      } else if (m.role === "ai" && m.type === "text") {
        apiMessages.push({ role: "assistant", content: m.content });
      }
    }

    const controller = new AbortController();
    abortRef.current = controller;

    let streamingText = "";

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: apiMessages,
          canvasContext: { scope: "canvas", panels: [] },
        }),
        signal: controller.signal,
      });

      if (!res.ok || !res.body) {
        setMessages((prev) => [
          ...prev,
          { role: "ai", type: "text", content: "Sorry, something went wrong." },
        ]);
        setIsStreaming(false);
        return;
      }

      const reader = res.body.getReader();
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
          const raw = line.slice(6);
          if (raw === "[DONE]") continue;

          let event: { type: string; [key: string]: unknown };
          try {
            event = JSON.parse(raw);
          } catch {
            continue;
          }

          switch (event.type) {
            case "text_delta": {
              streamingText += (event.content as string) || "";
              const text = streamingText;
              setMessages((prev) => {
                const last = prev[prev.length - 1];
                if (last?.role === "ai" && last.type === "streaming") {
                  return [...prev.slice(0, -1), { role: "ai", type: "streaming", content: text }];
                }
                return [...prev, { role: "ai", type: "streaming", content: text }];
              });
              break;
            }
            case "tool_call": {
              // Finalize streaming bubble if exists
              if (streamingText) {
                const finalText = streamingText;
                streamingText = "";
                setMessages((prev) => {
                  const last = prev[prev.length - 1];
                  if (last?.role === "ai" && last.type === "streaming") {
                    return [...prev.slice(0, -1), { role: "ai", type: "text", content: finalText }];
                  }
                  return prev;
                });
              }
              setMessages((prev) => [
                ...prev,
                { role: "ai", type: "tool_activity", toolName: event.name as string, status: "calling" },
              ]);
              break;
            }
            case "entry_reference": {
              const entry = (event as { entry?: EntryReference }).entry;
              if (!entry) break;
              setMessages((prev) => {
                // Merge into last entry_cards message if it exists
                const last = prev[prev.length - 1];
                if (last?.role === "ai" && last.type === "entry_cards") {
                  return [
                    ...prev.slice(0, -1),
                    { ...last, entries: [...last.entries, entry] },
                  ];
                }
                return [...prev, { role: "ai", type: "entry_cards", entries: [entry] }];
              });
              break;
            }
            case "tool_result": {
              setMessages((prev) => [
                ...prev,
                { role: "ai", type: "tool_activity", toolName: (event.name as string) || "tool", status: "done", summary: event.summary as string },
              ]);
              break;
            }
            case "done": {
              if (streamingText) {
                const finalText = streamingText;
                streamingText = "";
                setMessages((prev) => {
                  const last = prev[prev.length - 1];
                  if (last?.role === "ai" && last.type === "streaming") {
                    return [...prev.slice(0, -1), { role: "ai", type: "text", content: finalText }];
                  }
                  return prev;
                });
              }
              break;
            }
            case "error": {
              setMessages((prev) => [
                ...prev,
                { role: "ai", type: "text", content: `Error: ${event.message || "Unknown error"}` },
              ]);
              break;
            }
          }
        }
      }
    } catch (err) {
      if ((err as Error).name !== "AbortError") {
        setMessages((prev) => [
          ...prev,
          { role: "ai", type: "text", content: "Connection error. Please try again." },
        ]);
      }
    } finally {
      // Ensure any trailing streaming text is finalized
      if (streamingText) {
        const finalText = streamingText;
        setMessages((prev) => {
          const last = prev[prev.length - 1];
          if (last?.role === "ai" && last.type === "streaming") {
            return [...prev.slice(0, -1), { role: "ai", type: "text", content: finalText }];
          }
          return prev;
        });
      }
      setIsStreaming(false);
      abortRef.current = null;
    }
  }, [isStreaming, messages]);

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      send(input);
    }
  }

  return (
    <div className="flex flex-col h-full w-[280px] shrink-0 border-r border-white/[0.06]">
      {/* Messages */}
      <div ref={scrollRef} className="flex-1 min-h-0 overflow-y-auto px-3 py-3 space-y-2.5">
        {messages.length === 0 && (
          <div className="flex items-center justify-center h-full">
            <p className="text-[11px] text-white/25 text-center leading-relaxed px-4">
              Describe what you&apos;re looking for and I&apos;ll search the knowledge base for you.
            </p>
          </div>
        )}
        {messages.map((msg, i) => (
          <MessageBubble key={i} message={msg} onAddEntry={onAddEntry} />
        ))}
        {isStreaming && messages[messages.length - 1]?.type !== "streaming" && (
          <div className="flex items-center gap-1.5 px-2 py-1">
            <div className="w-1.5 h-1.5 rounded-full bg-white/30 animate-pulse" />
            <span className="font-mono text-[9px] text-white/30 uppercase">Thinking...</span>
          </div>
        )}
      </div>

      {/* Input */}
      <div className="shrink-0 px-3 pb-3 pt-1">
        <div className="relative">
          <textarea
            ref={textareaRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="What are you looking for?"
            rows={1}
            className="w-full resize-none px-3 py-2 pr-8 text-[12px] text-white/90 bg-white/[0.04] border border-white/[0.1] rounded-[4px] outline-none placeholder:text-white/30 focus:border-white/[0.2] focus:bg-white/[0.06] transition-colors leading-relaxed"
            style={{ maxHeight: 80 }}
          />
          <button
            type="button"
            onClick={() => send(input)}
            disabled={!input.trim() || isStreaming}
            className="absolute right-2 bottom-2 text-white/40 hover:text-white/80 disabled:opacity-30 transition-colors"
          >
            <Send className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Message rendering ─────────────────────────────────────────────

function MessageBubble({
  message,
  onAddEntry,
}: {
  message: BrowseMessage;
  onAddEntry: (entryId: string) => void;
}) {
  switch (message.type) {
    case "text":
      if (message.role === "user") {
        return (
          <div className="flex justify-end">
            <div className="max-w-[90%] px-2.5 py-1.5 rounded-[6px] bg-white/[0.08] border border-white/[0.1] text-[11px] text-white/85 leading-relaxed whitespace-pre-wrap">
              {message.content}
            </div>
          </div>
        );
      }
      return (
        <div className="max-w-[95%] text-[11px] text-white/70 leading-relaxed whitespace-pre-wrap">
          {message.content}
        </div>
      );

    case "streaming":
      return (
        <div className="max-w-[95%] text-[11px] text-white/70 leading-relaxed whitespace-pre-wrap">
          {message.content}
          <span className="inline-block w-[2px] h-3 bg-white/50 animate-pulse ml-0.5 align-middle" />
        </div>
      );

    case "tool_activity":
      return (
        <div className="flex items-center gap-1.5 px-2 py-1">
          {message.status === "calling" ? (
            <div className="w-1.5 h-1.5 rounded-full bg-white/30 animate-pulse" />
          ) : (
            <div className="w-1.5 h-1.5 rounded-full bg-emerald-400/60" />
          )}
          <span className="font-mono text-[9px] text-white/40 uppercase">
            {message.status === "calling" ? "Searching..." : "Found results"}
          </span>
        </div>
      );

    case "entry_cards":
      return (
        <div className="space-y-1.5">
          {message.entries.map((entry, idx) => (
            <button
              key={entry.entry_id || idx}
              type="button"
              onClick={() => onAddEntry(entry.entry_id)}
              className="w-full text-left px-2.5 py-2 rounded-[4px] bg-white/[0.03] border border-white/[0.08] hover:bg-white/[0.06] hover:border-white/[0.14] transition-colors cursor-pointer"
            >
              <div className="text-[11px] font-medium text-white/80 line-clamp-1">
                {entry.title || "Untitled"}
              </div>
              {entry.summary && (
                <div className="text-[10px] text-white/40 line-clamp-2 mt-0.5 leading-relaxed">
                  {entry.summary}
                </div>
              )}
              {entry.complexity && (
                <span className="inline-block mt-1 font-mono text-[8px] uppercase tracking-wide text-white/30 bg-white/[0.04] px-1.5 py-0.5 rounded-[2px]">
                  {entry.complexity}
                </span>
              )}
            </button>
          ))}
        </div>
      );

    default:
      return null;
  }
}

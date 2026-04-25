"use client";

/**
 * SmartChatPanel — left-rail conversational search on the browse
 * page. One fixed-size glass surface. Each user message hits
 * /api/query and renders the top matching entries inline as a compact
 * clickable list (retrieval, not synthesis).
 *
 * The outer box is fixed-size so the panel visually "holds" against
 * the top nav. Only the messages area scrolls.
 *
 * Filters were previously bolted onto the top of this panel. Removed
 * — the chat is the search mechanism, and browse-grid filtering will
 * ship as a separate affordance when we need it.
 */

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Search, ArrowUp, Loader2 } from "lucide-react";
import { GlassCard, MonoLabel, PlatformIcon } from "@/shared/design";

// ── Chat types ───────────────────────────────────────────────────────

interface ChatResultEntry {
  entry_id: string;
  title: string | null;
  summary: string | null;
  source_platform?: string | null;
  similarity?: number;
}

interface ChatMessage {
  id: number;
  role: "user" | "assistant";
  text: string;
  results?: ChatResultEntry[];
  error?: boolean;
}

export function SmartChatPanel() {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const nextId = useRef(1);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Auto-scroll chat to bottom as messages land.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [messages, sending]);

  async function handleSend() {
    const q = input.trim();
    if (!q || sending) return;

    const userMsg: ChatMessage = {
      id: nextId.current++,
      role: "user",
      text: q,
    };
    setMessages((m) => [...m, userMsg]);
    setInput("");
    setSending(true);

    try {
      const res = await fetch("/api/query", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query: q, max_results: 6 }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      const results: ChatResultEntry[] = Array.isArray(data.entries)
        ? data.entries
        : [];

      const reply: ChatMessage = {
        id: nextId.current++,
        role: "assistant",
        text:
          results.length === 0
            ? "I couldn't find anything matching that. Try different wording or add a tool name."
            : `Found ${results.length} relevant setup${results.length === 1 ? "" : "s"}:`,
        results,
      };
      setMessages((m) => [...m, reply]);
    } catch (err) {
      const msg =
        err instanceof Error ? err.message : "Search failed. Try again.";
      setMessages((m) => [
        ...m,
        {
          id: nextId.current++,
          role: "assistant",
          text: msg,
          error: true,
        },
      ]);
    } finally {
      setSending(false);
    }
  }

  function handleKey(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  }

  return (
    <GlassCard
      variant="subtle"
      className="!p-0 h-full flex flex-col overflow-hidden"
    >
      {/* ── Chat header ── */}
      <div className="flex items-center justify-between px-4 h-10 border-b border-white/[0.1] shrink-0">
        <MonoLabel tone="muted">Smart chat</MonoLabel>
        <Search size={12} className="text-white/30" />
      </div>

      {/* ── Chat scroll area ── */}
      <div
        ref={scrollRef}
        className="flex-1 min-h-0 overflow-y-auto px-4 py-4 space-y-4"
      >
        {messages.length === 0 && !sending && (
          <div className="text-xs text-white/30 leading-relaxed">
            Ask about setups in the knowledge base. Try{" "}
            <span className="text-white/50">
              &ldquo;AI agent for cold outreach&rdquo;
            </span>{" "}
            or{" "}
            <span className="text-white/50">
              &ldquo;n8n automation with Supabase&rdquo;
            </span>
            .
          </div>
        )}

        {messages.map((m) => (
          <MessageBubble key={m.id} message={m} />
        ))}

        {sending && (
          <div className="flex items-center gap-2 text-xs text-white/40">
            <Loader2 size={12} className="animate-spin" />
            <span className="font-mono uppercase tracking-wide text-[10px]">
              Searching knowledge base...
            </span>
          </div>
        )}
      </div>

      {/* ── Chat input (pinned bottom) — matches the canonical compact
          input style used in the canvas chat panel. */}
      <div className="shrink-0 p-3">
        <div className="relative rounded-xl overflow-hidden bg-white/[0.04] border border-white/[0.1] shadow-[0_2px_8px_rgba(0,0,0,0.3),inset_0_1px_0_rgba(255,255,255,0.06)] transition-colors duration-200 focus-within:bg-white/[0.06] focus-within:border-white/[0.18]">
          <div
            className="pointer-events-none absolute inset-x-0 top-0 h-px"
            style={{
              background:
                "linear-gradient(90deg, transparent 0%, rgba(255,255,255,0.25) 30%, rgba(255,255,255,0.35) 50%, rgba(255,255,255,0.25) 70%, transparent 100%)",
            }}
          />
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKey}
            placeholder="Ask about a setup..."
            rows={1}
            className="w-full bg-transparent px-3 pt-3 pb-1.5 text-xs leading-[18px] text-white/90 outline-none resize-none placeholder:text-white/30 disabled:opacity-50 min-h-[36px] max-h-[120px]"
          />
          <div className="flex items-center justify-end px-2 pb-2">
            <button
              onClick={handleSend}
              disabled={sending || !input.trim()}
              aria-label={sending ? "Sending" : "Send"}
              className="w-7 h-7 flex items-center justify-center text-white/50 hover:text-white/90 border border-white/[0.12] hover:border-white/[0.22] rounded-full transition-colors disabled:opacity-40 disabled:cursor-not-allowed bg-white/[0.04] hover:bg-white/[0.08]"
            >
              <ArrowUp size={14} />
            </button>
          </div>
        </div>
      </div>
    </GlassCard>
  );
}

// ── Sub-components ───────────────────────────────────────────────────

function MessageBubble({ message }: { message: ChatMessage }) {
  if (message.role === "user") {
    return (
      <div className="flex justify-end">
        <div className="max-w-[90%] bg-white/[0.08] border border-white/[0.12] rounded-[3px] px-3 py-2 text-xs text-white/90 leading-relaxed whitespace-pre-wrap">
          {message.text}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <div
        className={`text-xs leading-relaxed ${message.error ? "text-red-400" : "text-white/70"}`}
      >
        {message.text}
      </div>
      {message.results && message.results.length > 0 && (
        <ul className="space-y-1.5">
          {message.results.map((r) => (
            <li key={r.entry_id}>
              <Link
                href={`/entries/${r.entry_id}`}
                target="_blank"
                rel="noopener"
                className="flex items-start gap-2 p-2 border border-white/[0.08] hover:border-white/[0.18] hover:bg-white/[0.04] rounded-[3px] transition-colors group"
              >
                <span className="shrink-0 mt-0.5 text-white/50 group-hover:text-white/80 transition-colors">
                  <PlatformIcon
                    platform={r.source_platform || "web"}
                    className="w-3.5 h-3.5 fill-current"
                  />
                </span>
                <span className="flex-1 min-w-0">
                  <span className="block text-xs text-white/90 line-clamp-1 group-hover:text-white transition-colors">
                    {r.title || "Untitled"}
                  </span>
                  {r.summary && (
                    <span className="block text-[11px] text-white/40 line-clamp-2 leading-snug mt-0.5">
                      {r.summary}
                    </span>
                  )}
                </span>
                {typeof r.similarity === "number" && (
                  <span className="shrink-0 font-mono text-[9px] uppercase tracking-wide text-white/40">
                    {(r.similarity * 100).toFixed(0)}%
                  </span>
                )}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

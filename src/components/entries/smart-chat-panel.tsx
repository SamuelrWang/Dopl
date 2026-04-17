"use client";

/**
 * SmartChatPanel — the left-rail panel on /entries. One fixed-size
 * glass surface with two sections:
 *
 *   1. Filters (collapsible) — the legacy use-case / complexity
 *      filters, stays up top so the user can tighten the grid on the
 *      right without leaving the panel. Header is click-to-toggle.
 *
 *   2. Smart chat — a conversational search UI. Messages live in the
 *      scroll area; the input pins to the bottom. Each user message
 *      calls /api/query and renders the top matching entries inline
 *      as a compact result list (not a textual answer — /api/query
 *      is retrieval, not synthesis).
 *
 * The outer box is fixed-size (sticky height) so the panel visually
 * "holds" against the top nav. Only the middle scrolls.
 */

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { ChevronDown, Search, ArrowUp, Loader2 } from "lucide-react";
import { GlassCard, MonoLabel, PlatformIcon } from "@/components/design";

// ── Filter constants (mirror the old FilterSidebar) ──────────────────

const USE_CASES = [
  "all",
  "cold_outbound",
  "lead_gen",
  "content_creation",
  "data_pipeline",
  "monitoring",
  "automation",
  "agent_system",
  "dev_tooling",
  "customer_support",
  "research",
  "other",
];

const COMPLEXITIES = ["all", "simple", "moderate", "complex", "advanced"];

const COMPLEXITY_ACCENT: Record<string, string> = {
  simple: "var(--mint)",
  moderate: "var(--gold)",
  complex: "var(--coral)",
  advanced: "var(--coral)",
};

function labelize(v: string): string {
  if (v === "all") return "All";
  return v.replace(/_/g, " ");
}

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

interface Props {
  useCase: string;
  complexity: string;
  onUseCaseChange: (value: string) => void;
  onComplexityChange: (value: string) => void;
  onReset: () => void;
}

export function SmartChatPanel({
  useCase,
  complexity,
  onUseCaseChange,
  onComplexityChange,
  onReset,
}: Props) {
  const [filtersOpen, setFiltersOpen] = useState(true);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const nextId = useRef(1);
  const scrollRef = useRef<HTMLDivElement>(null);

  const hasActiveFilters = useCase !== "all" || complexity !== "all";
  const activeFilterCount =
    (useCase !== "all" ? 1 : 0) + (complexity !== "all" ? 1 : 0);

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
      {/* ── Filters header (click to toggle) ── */}
      <button
        type="button"
        onClick={() => setFiltersOpen((o) => !o)}
        className="flex items-center justify-between px-4 h-10 border-b border-white/[0.1] hover:bg-white/[0.03] transition-colors shrink-0"
      >
        <MonoLabel tone="muted">
          Filters
          {activeFilterCount > 0 && (
            <span className="ml-2 text-white/80">· {activeFilterCount} active</span>
          )}
        </MonoLabel>
        <ChevronDown
          size={14}
          className={`text-white/40 transition-transform ${filtersOpen ? "rotate-180" : ""}`}
        />
      </button>

      {/* ── Filters body (collapsible) ── */}
      {filtersOpen && (
        <div className="shrink-0 border-b border-white/[0.1] p-3 space-y-4 max-h-[38%] overflow-y-auto">
          <div className="space-y-2">
            <MonoLabel tone="muted">Use Case</MonoLabel>
            <div className="grid grid-cols-2 gap-1">
              {USE_CASES.map((uc) => {
                const active = uc === useCase;
                return (
                  <button
                    key={uc}
                    onClick={() => onUseCaseChange(uc)}
                    className={`text-left px-2 py-1 font-mono text-[10px] uppercase tracking-wide rounded-[3px] truncate transition-colors ${
                      active
                        ? "bg-white/[0.10] text-white/90 border border-white/[0.18]"
                        : "text-white/40 hover:text-white/70 hover:bg-white/[0.04] border border-transparent"
                    }`}
                    title={labelize(uc)}
                  >
                    {labelize(uc)}
                  </button>
                );
              })}
            </div>
          </div>

          <div className="space-y-2">
            <MonoLabel tone="muted">Complexity</MonoLabel>
            <div className="flex flex-wrap gap-1">
              {COMPLEXITIES.map((c) => {
                const active = c === complexity;
                const accent = c !== "all" ? COMPLEXITY_ACCENT[c] : undefined;
                return (
                  <button
                    key={c}
                    onClick={() => onComplexityChange(c)}
                    className={`flex items-center gap-1.5 px-2 py-1 font-mono text-[10px] uppercase tracking-wide rounded-[3px] transition-colors ${
                      active
                        ? "bg-white/[0.10] text-white/90 border border-white/[0.18]"
                        : "text-white/40 hover:text-white/70 hover:bg-white/[0.04] border border-transparent"
                    }`}
                  >
                    {accent && (
                      <span
                        className="w-0.5 h-2.5 rounded-full shrink-0"
                        style={{ backgroundColor: accent }}
                        aria-hidden
                      />
                    )}
                    <span>{labelize(c)}</span>
                  </button>
                );
              })}
            </div>
          </div>

          {hasActiveFilters && (
            <button
              onClick={onReset}
              className="w-full h-7 font-mono text-[10px] uppercase tracking-wide bg-white/[0.03] hover:bg-white/[0.08] border border-white/[0.08] hover:border-white/[0.15] rounded-[3px] text-white/60 hover:text-white/90 transition-all"
            >
              Reset filters
            </button>
          )}
        </div>
      )}

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

      {/* ── Chat input (pinned bottom) ── */}
      <div className="shrink-0 border-t border-white/[0.1] p-3">
        <div className="relative">
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKey}
            placeholder="Ask about a setup..."
            rows={2}
            className="w-full resize-none bg-white/[0.04] border border-white/[0.08] rounded-[3px] pl-3 pr-10 py-2 text-sm text-white/90 placeholder:text-white/25 outline-none focus:border-white/[0.18] transition-colors"
          />
          <button
            onClick={handleSend}
            disabled={sending || !input.trim()}
            aria-label="Send"
            className="absolute right-2 bottom-2 w-7 h-7 flex items-center justify-center rounded-[3px] bg-white/[0.08] hover:bg-white/[0.14] border border-white/[0.12] hover:border-white/[0.20] text-white/80 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            <ArrowUp size={14} />
          </button>
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

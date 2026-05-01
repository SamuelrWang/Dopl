"use client";

/**
 * Search box for the workspace's knowledge bases (Item 5.D).
 *
 * Debounced server-side full-text search. Renders a results dropdown
 * with title + snippet + rank. Clicking a hit calls `onSelectEntry`
 * (parent decides whether to navigate, open in the editor, etc.).
 *
 * Different from the tree's own search input (which is an in-memory
 * substring filter on titles) — this hits the tsvector RPC, scores
 * by ts_rank, and includes body matches.
 */

import { useEffect, useRef, useState } from "react";
import { Search, X } from "lucide-react";
import { cn } from "@/shared/lib/utils";
import {
  KnowledgeApiError,
  searchKnowledge,
  type KnowledgeSearchHit,
} from "../client/api";

interface Props {
  workspaceId: string;
  /** When set, results are scoped to this base. Omit for workspace-wide. */
  baseSlug?: string;
  /** Called when the user picks a hit. */
  onSelectEntry: (entryId: string, baseId: string) => void;
}

const DEBOUNCE_MS = 300;

export function KnowledgeSearch({
  workspaceId,
  baseSlug,
  onSelectEntry,
}: Props) {
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<KnowledgeSearchHit[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  // Click outside closes the dropdown.
  useEffect(() => {
    if (!open) return;
    function handle(e: MouseEvent) {
      if (
        containerRef.current &&
        !containerRef.current.contains(e.target as Node)
      ) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handle);
    return () => document.removeEventListener("mousedown", handle);
  }, [open]);

  // Debounced fetch. When query is empty we skip the fetch entirely;
  // old `hits`/`error` linger in state but the dropdown is gated on
  // `query.trim().length > 0` below, so they don't render.
  useEffect(() => {
    const trimmed = query.trim();
    if (trimmed.length === 0) return;
    let cancelled = false;
    const t = setTimeout(() => {
      searchKnowledge(trimmed, { baseSlug, limit: 10 }, workspaceId)
        .then((next) => {
          if (cancelled) return;
          setHits(next);
          setError(null);
        })
        .catch((err: unknown) => {
          if (cancelled) return;
          setError(
            err instanceof KnowledgeApiError
              ? err.message
              : err instanceof Error
                ? err.message
                : "Search failed"
          );
        })
        .finally(() => {
          if (!cancelled) setLoading(false);
        });
      if (!cancelled) setLoading(true);
    }, DEBOUNCE_MS);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [query, baseSlug, workspaceId]);

  return (
    <div ref={containerRef} className="relative">
      <div className="relative">
        <Search
          size={12}
          className="absolute left-2.5 top-1/2 -translate-y-1/2 text-text-secondary/50"
        />
        <input
          type="text"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          placeholder="Search content"
          className="w-full pl-7 pr-7 py-1 text-xs bg-white/[0.03] border border-white/[0.06] rounded-md text-text-primary placeholder:text-text-secondary/50 focus:outline-none focus:border-white/[0.15]"
        />
        {query ? (
          <button
            type="button"
            aria-label="Clear search"
            onClick={() => {
              setQuery("");
              setHits(null);
              setOpen(false);
            }}
            className="absolute right-1.5 top-1/2 -translate-y-1/2 w-5 h-5 rounded flex items-center justify-center hover:bg-white/[0.06]"
          >
            <X size={10} className="text-text-secondary/70" />
          </button>
        ) : null}
      </div>

      {open && query.trim().length > 0 ? (
        <div
          className="absolute z-30 left-0 right-0 mt-1 rounded-md border border-white/[0.1] bg-[oklch(0.16_0_0)] shadow-2xl shadow-black/60 max-h-80 overflow-y-auto"
        >
          {loading && hits === null ? (
            <p className="px-3 py-2 text-xs text-text-secondary">
              Searching…
            </p>
          ) : null}
          {error ? (
            <p className="px-3 py-2 text-xs text-red-400">{error}</p>
          ) : null}
          {hits && hits.length === 0 ? (
            <p className="px-3 py-2 text-xs text-text-secondary">
              No results.
            </p>
          ) : null}
          {hits?.map((hit) => (
            <button
              key={hit.entryId}
              type="button"
              onClick={() => {
                onSelectEntry(hit.entryId, hit.knowledgeBaseId);
                setOpen(false);
              }}
              className={cn(
                "w-full text-left px-3 py-2 hover:bg-white/[0.04] cursor-pointer border-b border-white/[0.04] last:border-b-0"
              )}
            >
              <p className="text-xs font-medium text-text-primary truncate">
                {hit.title}
              </p>
              <p className="mt-0.5 text-[11px] text-text-secondary leading-relaxed line-clamp-2">
                {renderSnippet(hit.snippet)}
              </p>
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

/**
 * Render a `ts_headline` snippet as React nodes. The RPC wraps matched
 * terms in `<b>…</b>`; we split on those bare tags and emit a `<strong>`
 * for the matched chunks and a text node for everything else.
 *
 * Avoids `dangerouslySetInnerHTML` — even though the RPC controls the
 * markup, body content is user-authored and can contain `<script>`,
 * `<iframe>`, etc. that ts_headline would faithfully preserve. Doing
 * the parse explicitly here means an attacker who somehow injects
 * markup into a body cannot escape the snippet rendering.
 */
function renderSnippet(snippet: string): React.ReactNode {
  // Tokenize on bare `<b>` / `</b>`; everything else (including any
  // other markup) is text.
  const parts = snippet.split(/(<b>|<\/b>)/g);
  const out: React.ReactNode[] = [];
  let highlighting = false;
  let i = 0;
  for (const part of parts) {
    if (part === "<b>") {
      highlighting = true;
      continue;
    }
    if (part === "</b>") {
      highlighting = false;
      continue;
    }
    if (part.length === 0) continue;
    if (highlighting) {
      out.push(
        <strong key={i++} className="text-text-primary font-semibold">
          {part}
        </strong>
      );
    } else {
      out.push(<span key={i++}>{part}</span>);
    }
  }
  return out;
}

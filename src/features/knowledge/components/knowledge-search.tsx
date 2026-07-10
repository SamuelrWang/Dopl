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
import { cn } from "@/shared/lib/utils";
import { SearchField } from "@/shared/ui/search-field";
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
      <SearchField
        value={query}
        onChange={(next) => {
          setQuery(next);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onClear={() => {
          setQuery("");
          setHits(null);
          setOpen(false);
        }}
        placeholder="Search content"
        size="sm"
      />

      {open && query.trim().length > 0 ? (
        <div
          className="absolute z-30 left-0 right-0 mt-1 rounded-md border border-border-default bg-[var(--bg-inset-hover)] shadow-2xl shadow-black/60 max-h-80 overflow-y-auto"
        >
          {loading && hits === null ? (
            <p className="px-3 py-2 text-small text-text-secondary">
              Searching…
            </p>
          ) : null}
          {error ? (
            <p className="px-3 py-2 text-small text-danger">{error}</p>
          ) : null}
          {hits && hits.length === 0 ? (
            <p className="px-3 py-2 text-small text-text-secondary">
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
                "w-full text-left px-3 py-2 hover:bg-surface-raised-2 cursor-pointer border-b border-border-subtle last:border-b-0"
              )}
            >
              <p className="text-small font-medium text-text-primary truncate">
                {hit.title}
              </p>
              <p className="mt-0.5 text-label text-text-secondary leading-relaxed line-clamp-2">
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

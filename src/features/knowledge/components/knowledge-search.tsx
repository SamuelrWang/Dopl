"use client";

/**
 * Debounced server-side full-text search over the workspace's knowledge bases.
 * Clicking a hit calls `onSelectEntry`; the parent decides what that means.
 *
 * NOT the tree's own search input (in-memory substring filter on titles):
 * this hits the tsvector RPC, scores by ts_rank, and matches bodies.
 */

import { userFacingMessage } from "@/shared/api/user-facing-message";
import { useEffect, useRef, useState } from "react";
import { SearchField } from "@/shared/ui/search-field";
import {
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

  // Empty query skips the fetch: stale `hits`/`error` linger in state but the
  // dropdown is gated on `query.trim().length > 0` below.
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
          setError(userFacingMessage(err));
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
        <div className="white-card absolute right-0 left-0 z-30 mt-1.5 max-h-80 overflow-y-auto p-1">
          {loading && hits === null ? (
            <p className="px-2.5 py-2 text-caption text-text-muted">
              Searching…
            </p>
          ) : null}
          {error ? (
            <p className="px-2.5 py-2 text-caption text-danger">{error}</p>
          ) : null}
          {hits && hits.length === 0 ? (
            <p className="px-2.5 py-2 text-caption text-text-muted">
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
              className="w-full rounded-lg px-2.5 py-2 text-left transition-colors hover:bg-menu-item-hover-bg"
            >
              <p className="text-small font-medium text-text-primary truncate">
                {hit.title}
              </p>
              <p className="mt-0.5 line-clamp-2 text-caption leading-relaxed text-text-muted">
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
 * `ts_headline` snippet → React nodes. RPC wraps matched terms in `<b>…</b>`.
 *
 * Never `dangerouslySetInnerHTML` here: bodies are user-authored and
 * ts_headline preserves any `<script>`/`<iframe>` in them, so parsing
 * explicitly is what stops injected markup escaping the snippet.
 */
function renderSnippet(snippet: string): React.ReactNode {
  // Tokenize on bare `<b>`/`</b>`; all other markup is text.
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

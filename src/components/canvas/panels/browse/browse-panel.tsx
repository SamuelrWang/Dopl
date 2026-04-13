"use client";

import { useCallback, useState } from "react";
import { useCanvas } from "../../canvas-store";
import { fetchFullEntry } from "../../add-to-canvas";
import type { BrowsePanelData } from "../../types";
import { useBrowseState } from "./use-browse-state";
import { BrowseEntryCard } from "./browse-entry-row";

interface BrowsePanelBodyProps {
  panel: BrowsePanelData;
}

export function BrowsePanelBody({ panel }: BrowsePanelBodyProps) {
  const { dispatch } = useCanvas();
  const browse = useBrowseState();
  const [addingId, setAddingId] = useState<string | null>(null);

  const handleAdd = useCallback(
    async (entryId: string) => {
      setAddingId(entryId);
      try {
        const entry = await fetchFullEntry(entryId);
        if (!entry) {
          setAddingId(null);
          return;
        }
        dispatch({
          type: "SPAWN_ENTRY_PANEL",
          sourcePanelId: panel.id,
          entryId: entry.id,
          title: entry.title || "Untitled Setup",
          summary: entry.summary ?? null,
          sourceUrl: entry.source_url ?? "",
          sourcePlatform: entry.source_platform ?? null,
          sourceAuthor: entry.source_author ?? null,
          thumbnailUrl: entry.thumbnail_url ?? null,
          useCase: entry.use_case ?? null,
          complexity: entry.complexity ?? null,
          tags: (entry.tags ?? []).map((t) => ({
            type: t.tag_type,
            value: t.tag_value,
          })),
          readme: entry.readme || "",
          agentsMd: entry.agents_md || "",
          manifest: entry.manifest || {},
        });
      } finally {
        setAddingId(null);
      }
    },
    [dispatch, panel.id]
  );

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter") {
      e.preventDefault();
      browse.handleSearch();
    } else if (e.key === "Escape") {
      if (browse.mode === "search") {
        browse.clearSearch();
      }
    }
  }

  return (
    <div className="flex flex-col h-full" data-no-drag>
      {/* Search bar */}
      <div className="shrink-0 px-3 pt-3">
        <div className="relative">
          <input
            type="text"
            value={browse.query}
            onChange={(e) => browse.setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Search entries..."
            className="w-full h-8 px-3 pr-8 text-[13px] text-white/90 bg-white/[0.04] border border-white/[0.1] rounded-[4px] outline-none placeholder:text-white/30 focus:border-white/[0.2] focus:bg-white/[0.06] transition-colors"
          />
          {browse.mode === "search" ? (
            <button
              type="button"
              onClick={browse.clearSearch}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-white/40 hover:text-white/80 transition-colors"
              aria-label="Clear search"
            >
              <svg
                width="12"
                height="12"
                viewBox="0 0 12 12"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
                aria-hidden
              >
                <path d="M3 3l6 6M9 3l-6 6" />
              </svg>
            </button>
          ) : (
            <button
              type="button"
              onClick={browse.handleSearch}
              disabled={!browse.query.trim()}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-white/40 hover:text-white/80 transition-colors disabled:opacity-30"
              aria-label="Search"
            >
              <svg
                width="12"
                height="12"
                viewBox="0 0 12 12"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
                aria-hidden
              >
                <circle cx="5" cy="5" r="3.5" />
                <path d="M8 8l2.5 2.5" />
              </svg>
            </button>
          )}
        </div>
      </div>

      {/* Controls row */}
      <div className="shrink-0 flex items-center justify-between px-3 py-2">
        <span className="font-mono text-[10px] uppercase tracking-wide text-white/40">
          {browse.loading
            ? browse.mode === "search"
              ? "Searching..."
              : "Loading..."
            : browse.mode === "search"
              ? `${browse.totalCount} result${browse.totalCount !== 1 ? "s" : ""}`
              : `${browse.totalCount} entr${browse.totalCount !== 1 ? "ies" : "y"}`}
        </span>
        {browse.mode === "browse" && (
          <select
            value={browse.sort}
            onChange={(e) =>
              browse.setSort(
                e.target.value as "newest" | "oldest" | "alpha"
              )
            }
            className="font-mono text-[10px] uppercase tracking-wide bg-transparent border border-white/[0.1] rounded-[3px] text-white/50 px-2 h-6 outline-none hover:border-white/[0.2] focus:border-white/[0.2] transition-colors cursor-pointer"
          >
            <option value="newest">Newest</option>
            <option value="oldest">Oldest</option>
            <option value="alpha">A-Z</option>
          </select>
        )}
      </div>

      {/* Synthesis card (search mode) */}
      {browse.synthesis && !browse.loading && (
        <div className="shrink-0 mx-3 mb-2 p-3 rounded-[4px] bg-white/[0.03] border border-white/[0.08]">
          <div className="font-mono text-[9px] uppercase tracking-wider text-white/40 mb-1.5">
            AI Recommendation
          </div>
          <p className="text-[12px] leading-relaxed text-white/70 line-clamp-4">
            {browse.synthesis.recommendation}
          </p>
        </div>
      )}

      {/* Results grid */}
      <div className="flex-1 min-h-0 overflow-y-auto px-3 pb-3">
        {browse.loading ? (
          <div className="grid grid-cols-3 gap-2">
            {Array.from({ length: 6 }).map((_, i) => (
              <div
                key={i}
                className="rounded-[6px] overflow-hidden bg-white/[0.03] border border-white/[0.08]"
              >
                <div className="aspect-[16/9] bg-white/[0.04] animate-pulse" />
                <div className="px-2.5 py-2 space-y-1.5">
                  <div className="h-3 w-3/4 rounded bg-white/[0.06] animate-pulse" />
                  <div className="h-2 w-1/3 rounded bg-white/[0.04] animate-pulse" />
                </div>
              </div>
            ))}
          </div>
        ) : browse.error ? (
          <div className="flex items-center justify-center h-full px-4">
            <span className="font-mono text-[11px] text-[color:var(--coral)] text-center">
              {browse.error}
            </span>
          </div>
        ) : browse.entries.length === 0 ? (
          <div className="flex items-center justify-center h-full px-4">
            <span className="font-mono text-[11px] text-white/30 text-center">
              {browse.mode === "search"
                ? "No results found"
                : "No entries yet"}
            </span>
          </div>
        ) : (
          <div className="grid grid-cols-3 gap-2">
            {browse.entries.map((entry) => (
              <BrowseEntryCard
                key={entry.id}
                entry={entry}
                onAdd={handleAdd}
                adding={addingId === entry.id}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

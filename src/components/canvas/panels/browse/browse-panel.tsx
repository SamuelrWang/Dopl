"use client";

import { useCallback, useRef, useState } from "react";
import { Bookmark } from "lucide-react";
import { useCanvas, useCanvasStateRef } from "../../canvas-store";
import { fetchFullEntry } from "../../add-to-canvas";
import type { BrowsePanelData } from "../../types";
import { useBrowseState, type BrowseEntry } from "./use-browse-state";
import { useBookmarks } from "./use-bookmarks";
import { BrowseEntryCard } from "./browse-entry-row";
import { DragGhost, type DragGhostHandle } from "./drag-ghost";
import { BrowseChat } from "./browse-chat";

interface BrowsePanelBodyProps {
  panel: BrowsePanelData;
}

export function BrowsePanelBody({ panel }: BrowsePanelBodyProps) {
  const { dispatch } = useCanvas();
  const canvasStateRef = useCanvasStateRef();
  const browse = useBrowseState();
  const bookmarks = useBookmarks();
  const [addingId, setAddingId] = useState<string | null>(null);
  const [showBookmarkedOnly, setShowBookmarkedOnly] = useState(false);

  // Drag state — uses refs to avoid re-renders per pointer move
  const ghostRef = useRef<DragGhostHandle>(null);
  const dragEntryRef = useRef<BrowseEntry | null>(null);

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
    [dispatch, panel.id],
  );

  // ── Drag callbacks ──────────────────────────────────────────────

  const handleDragMove = useCallback(
    (entryId: string, clientX: number, clientY: number) => {
      // Show ghost on first move
      if (!dragEntryRef.current) {
        const entry = browse.entries.find((e) => e.id === entryId);
        if (!entry) return;
        dragEntryRef.current = entry;
        ghostRef.current?.show(entry);
      }
      ghostRef.current?.updatePosition(clientX, clientY);
    },
    [browse.entries],
  );

  const handleDragEnd = useCallback(
    async (entryId: string, clientX: number, clientY: number) => {
      ghostRef.current?.hide();
      dragEntryRef.current = null;

      // Convert screen → world coordinates
      const viewport = document.querySelector("[data-canvas-viewport]");
      const rect = viewport?.getBoundingClientRect() ?? { left: 0, top: 0 };
      const camera = canvasStateRef.current.camera;
      const worldX = (clientX - rect.left - camera.x) / camera.zoom;
      const worldY = (clientY - rect.top - camera.y) / camera.zoom;

      // Fetch full entry and spawn at drop position
      setAddingId(entryId);
      try {
        const entry = await fetchFullEntry(entryId);
        if (!entry) return;
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
          position: { x: worldX, y: worldY },
        });
      } finally {
        setAddingId(null);
      }
    },
    [dispatch, panel.id, canvasStateRef],
  );

  // ── Filtering ───────────────────────────────────────────────────

  const displayEntries = showBookmarkedOnly
    ? browse.entries.filter((e) => bookmarks.isBookmarked(e.id))
    : browse.entries;

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

  const countLabel = browse.loading
    ? browse.mode === "search"
      ? "Searching..."
      : "Loading..."
    : showBookmarkedOnly
      ? `${displayEntries.length} bookmarked`
      : browse.mode === "search"
        ? `${browse.totalCount} result${browse.totalCount !== 1 ? "s" : ""}`
        : `${browse.totalCount} entr${browse.totalCount !== 1 ? "ies" : "y"}`;

  return (
    <div className="flex h-full" data-no-drag>
      {/* Left: AI Chat */}
      <BrowseChat onAddEntry={handleAdd} />

      {/* Right: Browse grid */}
      <div className="flex flex-col flex-1 min-w-0 h-full">
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
          {countLabel}
        </span>
        <div className="flex items-center gap-1.5">
          {/* Bookmark filter toggle */}
          <button
            type="button"
            onClick={() => setShowBookmarkedOnly((v) => !v)}
            className={`inline-flex h-6 items-center gap-1 px-2 font-mono text-[10px] uppercase tracking-wide rounded-[3px] border transition-colors ${
              showBookmarkedOnly
                ? "bg-white/[0.08] border-white/[0.2] text-white/80"
                : "bg-transparent border-white/[0.1] text-white/40 hover:border-white/[0.2] hover:text-white/60"
            }`}
          >
            <Bookmark className="w-3 h-3" fill={showBookmarkedOnly ? "currentColor" : "none"} strokeWidth={showBookmarkedOnly ? 0 : 2} />
            Saved
          </button>
          {browse.mode === "browse" && (
            <select
              value={browse.sort}
              onChange={(e) =>
                browse.setSort(
                  e.target.value as "newest" | "oldest" | "alpha",
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
        ) : displayEntries.length === 0 ? (
          <div className="flex items-center justify-center h-full px-4">
            <span className="font-mono text-[11px] text-white/30 text-center">
              {showBookmarkedOnly
                ? "No bookmarked entries"
                : browse.mode === "search"
                  ? "No results found"
                  : "No entries yet"}
            </span>
          </div>
        ) : (
          <div className="grid grid-cols-3 gap-2">
            {displayEntries.map((entry) => (
              <BrowseEntryCard
                key={entry.id}
                entry={entry}
                onAdd={handleAdd}
                adding={addingId === entry.id}
                isBookmarked={bookmarks.isBookmarked(entry.id)}
                onToggleBookmark={bookmarks.toggleBookmark}
                onDragMove={handleDragMove}
                onDragEnd={handleDragEnd}
              />
            ))}
          </div>
        )}
      </div>

      {/* Drag ghost — rendered via portal */}
      <DragGhost ref={ghostRef} />
      </div>
    </div>
  );
}

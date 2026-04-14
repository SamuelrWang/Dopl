"use client";

import { useRef, useCallback } from "react";
import { useState } from "react";
import { Bookmark } from "lucide-react";
import type { BrowseEntry } from "./use-browse-state";

const platformLabels: Record<string, string> = {
  x: "X",
  instagram: "IG",
  reddit: "Reddit",
  github: "GitHub",
  web: "Web",
};

const placeholderGradients: Record<string, string> = {
  x: "from-neutral-900 to-black",
  instagram: "from-fuchsia-900 via-pink-900 to-orange-900",
  reddit: "from-orange-900 to-red-950",
  github: "from-neutral-800 to-neutral-900",
  web: "from-slate-900 to-black",
};

const DRAG_THRESHOLD = 5;

interface BrowseEntryCardProps {
  entry: BrowseEntry;
  onAdd: (entryId: string) => void;
  adding?: boolean;
  isBookmarked?: boolean;
  onToggleBookmark?: (entryId: string) => void;
  onDragMove?: (entryId: string, clientX: number, clientY: number) => void;
  onDragEnd?: (entryId: string, clientX: number, clientY: number) => void;
}

export function BrowseEntryCard({
  entry,
  onAdd,
  adding,
  isBookmarked,
  onToggleBookmark,
  onDragMove,
  onDragEnd,
}: BrowseEntryCardProps) {
  const platform = entry.source_platform || "web";
  const label = platformLabels[platform] || platform;
  const gradient = placeholderGradients[platform] || placeholderGradients.web;
  const [imgError, setImgError] = useState(false);

  // Drag state
  const pointerStartRef = useRef<{ x: number; y: number; pointerId: number } | null>(null);
  const isDraggingRef = useRef(false);

  const handlePointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      // Ignore if clicking on the bookmark button
      if ((e.target as HTMLElement).closest("[data-bookmark-btn]")) return;
      pointerStartRef.current = { x: e.clientX, y: e.clientY, pointerId: e.pointerId };
      isDraggingRef.current = false;
      e.currentTarget.setPointerCapture(e.pointerId);
    },
    [],
  );

  const handlePointerMove = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      const start = pointerStartRef.current;
      if (!start) return;
      const dist = Math.hypot(e.clientX - start.x, e.clientY - start.y);
      if (dist > DRAG_THRESHOLD) {
        isDraggingRef.current = true;
        onDragMove?.(entry.id, e.clientX, e.clientY);
      }
    },
    [entry.id, onDragMove],
  );

  const handlePointerUp = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      const target = e.currentTarget;
      if (target.hasPointerCapture(e.pointerId)) {
        target.releasePointerCapture(e.pointerId);
      }
      if (isDraggingRef.current) {
        onDragEnd?.(entry.id, e.clientX, e.clientY);
      } else if (pointerStartRef.current) {
        // Click — trigger add
        onAdd(entry.id);
      }
      pointerStartRef.current = null;
      isDraggingRef.current = false;
    },
    [entry.id, onAdd, onDragEnd],
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        onAdd(entry.id);
      }
    },
    [entry.id, onAdd],
  );

  return (
    <div
      role="button"
      tabIndex={0}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerUp}
      onKeyDown={handleKeyDown}
      className={`w-full text-left rounded-[6px] overflow-hidden bg-white/[0.03] border border-white/[0.08] hover:bg-white/[0.06] hover:border-white/[0.14] transition-colors cursor-pointer select-none ${adding ? "opacity-50 pointer-events-none" : ""} group`}
    >
      {/* Thumbnail */}
      <div className="relative aspect-[16/9] overflow-hidden">
        {entry.thumbnail_url && !imgError ? (
          <img
            src={entry.thumbnail_url}
            alt={entry.title || "Entry thumbnail"}
            className="w-full h-full object-cover group-hover:scale-[1.02] transition-transform duration-300"
            loading="lazy"
            draggable={false}
            onError={() => setImgError(true)}
          />
        ) : (
          <div
            className={`w-full h-full bg-gradient-to-br ${gradient} flex items-center justify-center`}
          >
            <span className="font-mono text-sm font-bold text-white/20 uppercase tracking-widest">
              {label}
            </span>
          </div>
        )}

        {/* Platform badge */}
        <div className="absolute top-1.5 left-1.5">
          <span className="inline-block font-mono text-[8px] uppercase tracking-wider text-white/80 bg-black/40 backdrop-blur-sm px-1.5 py-0.5 rounded-[2px]">
            {label}
          </span>
        </div>

        {/* Bookmark button */}
        {onToggleBookmark && (
          <button
            data-bookmark-btn
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onToggleBookmark(entry.id);
            }}
            onPointerDown={(e) => e.stopPropagation()}
            className={`absolute top-1.5 right-1.5 w-5 h-5 flex items-center justify-center rounded-[2px] backdrop-blur-sm transition-colors ${
              isBookmarked
                ? "bg-white/20 text-white/90"
                : "bg-black/40 text-white/40 opacity-0 group-hover:opacity-100"
            }`}
            title={isBookmarked ? "Remove bookmark" : "Bookmark"}
          >
            <Bookmark
              className="w-3 h-3"
              fill={isBookmarked ? "currentColor" : "none"}
              strokeWidth={isBookmarked ? 0 : 2}
            />
          </button>
        )}

        {/* Similarity badge (search mode) */}
        {entry.similarity != null && (
          <div className="absolute bottom-1.5 right-1.5">
            <span className="inline-block font-mono text-[9px] tracking-wide text-white/90 bg-black/40 backdrop-blur-sm px-1.5 py-0.5 rounded-[2px]">
              {Math.round(entry.similarity * 100)}%
            </span>
          </div>
        )}
      </div>

      {/* Info */}
      <div className="px-2.5 py-2 space-y-1">
        <div className="text-[12px] leading-snug text-white/85 line-clamp-1 font-medium">
          {entry.title || "Untitled"}
        </div>
        {entry.summary && (
          <p className="text-[10px] leading-relaxed text-white/45 line-clamp-2">
            {entry.summary}
          </p>
        )}
      </div>
    </div>
  );
}

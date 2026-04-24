"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { Bookmark } from "lucide-react";
import { GlassCard, MonoLabel, PlatformIcon } from "@/components/design";
import {
  addEntryPanelToCanvas,
  fetchFullEntry,
} from "@/features/canvas/add-to-canvas";
import { useSavedToggle } from "@/lib/saved/local-store";
import { useEntryPreviewActions } from "./entry-preview-context";

interface EntryCardProps {
  id: string;
  title: string | null;
  summary: string | null;
  sourceUrl: string;
  sourcePlatform: string | null;
  thumbnailUrl: string | null;
  useCase: string | null;
  complexity: string | null;
  status: string;
  createdAt: string;
}


const platformLabels: Record<string, string> = {
  x: "X",
  instagram: "IG",
  reddit: "Reddit",
  github: "GitHub",
  youtube: "YouTube",
  hackernews: "HN",
  stackoverflow: "SO",
  medium: "Medium",
  substack: "Substack",
  devto: "Dev.to",
  arxiv: "arXiv",
  web: "Web",
};

const placeholderGradients: Record<string, string> = {
  x: "from-neutral-900 to-black",
  instagram: "from-fuchsia-900 via-pink-900 to-orange-900",
  reddit: "from-orange-900 to-red-950",
  github: "from-neutral-800 to-neutral-900",
  web: "from-slate-900 to-black",
};

function truncateUrl(url: string): string {
  try {
    const u = new URL(url);
    const path =
      u.pathname.length > 30 ? u.pathname.slice(0, 27) + "..." : u.pathname;
    return u.hostname.replace("www.", "") + path;
  } catch {
    return url.slice(0, 50);
  }
}

// Note: `complexity` is still sent by EntryGrid but no longer rendered
// — the old complexity pill was replaced with the bookmark toggle.
// Kept on the props interface so the grid callsite stays unchanged.
export function EntryCard({
  id,
  title,
  summary,
  sourceUrl,
  sourcePlatform,
  thumbnailUrl,
  useCase,
  status,
  createdAt,
}: EntryCardProps) {
  const platform = sourcePlatform || "web";
  const gradientClass = placeholderGradients[platform] || placeholderGradients.web;

  // Preview-panel integration. `previewActions` is a stable reference
  // (see entry-preview-context.tsx), so subscribing here does NOT cause
  // this card to re-render when some other card opens the preview.
  // Null when rendered outside a provider (e.g. embedded in canvas) —
  // the anchor then falls back to its default new-tab behavior.
  const previewActions = useEntryPreviewActions();
  function handleCardClick(e: React.MouseEvent) {
    // Respect new-tab intents: ⌘/Ctrl/Shift-click and middle-click.
    if (
      !previewActions ||
      e.defaultPrevented ||
      e.button !== 0 ||
      e.metaKey ||
      e.ctrlKey ||
      e.shiftKey ||
      e.altKey
    ) {
      return;
    }
    e.preventDefault();
    previewActions.openPreview(id);
  }

  // Save-for-later state — drives the bookmark toggle that replaced
  // the old complexity pill. Writes to localStorage via the shared
  // saved store; the Saved tab reads the same bucket.
  const { saved, toggle: toggleSaved } = useSavedToggle("entry", id);
  function handleBookmarkClick(e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    toggleSaved();
  }

  // "Add to canvas" button state:
  //  - idle   → "+" icon
  //  - loading → small spinner/"..." while we fetch the full entry
  //  - added  → checkmark-style confirmation for 1.5s, then back to idle
  //  - error  → "!" briefly, then back to idle
  const [addState, setAddState] = useState<
    "idle" | "loading" | "added" | "error"
  >("idle");

  // Cursor-following description popup. Only shown while the pointer
  // is over the card and the entry has a summary worth reading.
  const [hoverPos, setHoverPos] = useState<{ x: number; y: number } | null>(null);
  const [portalReady, setPortalReady] = useState(false);
  useEffect(() => {
    setPortalReady(true);
  }, []);

  const hasPopupContent = Boolean(summary && summary.trim().length > 0);
  const shouldShowPopup = hoverPos !== null && hasPopupContent && portalReady;

  function handleMouseMove(e: React.MouseEvent) {
    // clientX/Y — viewport-relative, matches position: fixed.
    setHoverPos({ x: e.clientX, y: e.clientY });
  }
  function handleMouseLeave() {
    setHoverPos(null);
  }

  function handleSourceClick(e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    window.open(sourceUrl, "_blank", "noopener");
  }

  async function handleAddToCanvas(e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    if (addState !== "idle") return;
    setAddState("loading");
    const entry = await fetchFullEntry(id);
    if (!entry) {
      setAddState("error");
      setTimeout(() => setAddState("idle"), 1500);
      return;
    }
    addEntryPanelToCanvas(entry)
      .then((ok) => setAddState(ok ? "added" : "error"))
      .catch(() => setAddState("error"))
      .finally(() => setTimeout(() => setAddState("idle"), 1500));
  }

  return (
    <a
      href={`/entries/${id}`}
      target="_blank"
      rel="noopener"
      className="group block h-full"
      onClick={handleCardClick}
      onMouseMove={handleMouseMove}
      onMouseLeave={handleMouseLeave}
    >
      <GlassCard
        variant="subtle"
        className="h-full !p-0 overflow-hidden hover:bg-white/[0.10] transition-colors cursor-pointer"
      >
        {/* Thumbnail */}
        <div className="relative aspect-video overflow-hidden">
          {thumbnailUrl ? (
            <img
              src={thumbnailUrl}
              alt={title || "Post thumbnail"}
              className="w-full h-full object-cover group-hover:scale-[1.02] transition-transform duration-300"
              loading="lazy"
              onError={(e) => {
                const target = e.currentTarget;
                target.style.display = "none";
                const fallback = target.nextElementSibling as HTMLElement;
                if (fallback) fallback.style.display = "flex";
              }}
            />
          ) : null}
          <div
            className={`w-full h-full bg-gradient-to-br ${gradientClass} flex items-center justify-center ${thumbnailUrl ? "hidden" : ""}`}
          >
            <span className="font-mono text-2xl font-bold text-white/20 uppercase tracking-widest">
              {platformLabels[platform] || "Dopl"}
            </span>
          </div>

          {/* Platform badge — brand SVG logo, matches the canvas entry panel */}
          <div className="absolute top-2 left-2">
            <span
              className="w-6 h-6 inline-flex items-center justify-center bg-[oklch(0.07_0_0)] border border-white/10 text-white/80 rounded-[3px]"
              title={platformLabels[platform] || "Web"}
              aria-label={platformLabels[platform] || "Web"}
            >
              <PlatformIcon platform={platform} className="w-3.5 h-3.5 fill-current" />
            </span>
          </div>

          {/* Status badge if not complete */}
          {status !== "complete" && (
            <div className="absolute top-2 right-2">
              <span
                className={`font-mono text-[9px] uppercase tracking-wider px-1.5 py-0.5 border rounded-[3px] ${
                  status === "error"
                    ? "bg-red-950/80 text-red-400 border-red-500/30"
                    : "bg-amber-950/80 text-amber-400 border-amber-500/30"
                }`}
              >
                {status === "pending_ingestion" ? "queued" : status}
              </span>
            </div>
          )}

        </div>

        {/* Content */}
        <div className="p-4 space-y-3">
          {/* Title */}
          <h3 className="font-medium text-sm line-clamp-2 leading-snug text-white/90 group-hover:text-white transition-colors">
            {title || "Untitled"}
          </h3>

          {/* Summary */}
          {summary && (
            <p className="text-xs text-white/50 line-clamp-2 leading-relaxed">
              {summary}
            </p>
          )}

          {/* Source URL */}
          <button
            onClick={handleSourceClick}
            className="font-mono text-[10px] text-white/40 hover:text-white/70 truncate block w-full text-left uppercase tracking-wide transition-colors"
            title={sourceUrl}
          >
            {truncateUrl(sourceUrl)}
          </button>

          {/* Metadata row: bookmark toggle + date. Replaced the old
              complexity pill — clicking the bookmark saves the entry
              to the Saved tab. */}
          <div className="flex items-center gap-3 pt-2 border-t border-white/[0.06]">
            <button
              onClick={handleBookmarkClick}
              aria-label={saved ? "Remove from saved" : "Save for later"}
              title={saved ? "Saved" : "Save"}
              className={`inline-flex items-center justify-center transition-colors cursor-pointer ${
                saved
                  ? "text-white"
                  : "text-white/40 hover:text-white/80"
              }`}
            >
              <Bookmark
                size={15}
                strokeWidth={1.75}
                fill={saved ? "currentColor" : "none"}
              />
            </button>
            {useCase && (
              <MonoLabel tone="muted">{useCase.replace(/_/g, " ")}</MonoLabel>
            )}
            <span className="font-mono text-[10px] text-white/30 ml-auto">
              {new Date(createdAt).toLocaleDateString("en-US", {
                month: "short",
                day: "numeric",
              })}
            </span>
          </div>

          {/* Add to canvas button */}
          {status === "complete" && (
            <button
              onClick={handleAddToCanvas}
              className={`w-full h-8 font-mono text-[10px] uppercase tracking-wide border rounded-[3px] transition-all ${
                addState === "added"
                  ? "bg-emerald-500/[0.1] border-emerald-500/30 text-emerald-400"
                  : addState === "error"
                    ? "bg-red-500/[0.1] border-red-500/30 text-red-400"
                    : addState === "loading"
                      ? "bg-white/[0.05] border-white/[0.1] text-white/50"
                      : "bg-white/[0.05] hover:bg-white/[0.10] border-white/[0.1] hover:border-white/[0.2] text-white/70 hover:text-white/90"
              }`}
            >
              {addState === "loading" ? "Adding..." : addState === "added" ? "Added" : addState === "error" ? "Failed" : "Add to Canvas"}
            </button>
          )}
        </div>
      </GlassCard>
      {shouldShowPopup &&
        createPortal(
          <HoverDescriptionPopup
            x={hoverPos!.x}
            y={hoverPos!.y}
            title={title}
            summary={summary!}
          />,
          document.body
        )}
    </a>
  );
}

/**
 * Floating description popup that follows the cursor. Rendered via
 * portal to `document.body` so parent overflow/transform doesn't clip
 * it, and with `pointer-events: none` so the card's hover state stays
 * active while the popup is visible. Self-clamps to the viewport so
 * it doesn't spill off the right or bottom edge.
 */
function HoverDescriptionPopup({
  x,
  y,
  title,
  summary,
}: {
  x: number;
  y: number;
  title: string | null;
  summary: string;
}) {
  const OFFSET = 16;
  const MAX_WIDTH = 360;
  const ESTIMATED_HEIGHT = 180; // conservative — only used for edge-clamp

  // Flip horizontally if the popup would spill off the right edge.
  const vw = typeof window !== "undefined" ? window.innerWidth : 1440;
  const vh = typeof window !== "undefined" ? window.innerHeight : 900;
  const flipLeft = x + OFFSET + MAX_WIDTH > vw;
  const flipUp = y + OFFSET + ESTIMATED_HEIGHT > vh;
  const left = flipLeft ? x - OFFSET - MAX_WIDTH : x + OFFSET;
  const top = flipUp ? y - OFFSET - ESTIMATED_HEIGHT : y + OFFSET;

  return (
    <div
      style={{
        position: "fixed",
        left,
        top,
        maxWidth: MAX_WIDTH,
        pointerEvents: "none",
        zIndex: 9999,
      }}
      className="bg-[#0a0a0a] border border-white/[0.12] rounded-[4px] shadow-2xl shadow-black/60 px-3 py-2.5 text-xs text-white/80 leading-relaxed"
    >
      {title && (
        <div className="font-medium text-white/95 text-[13px] mb-1.5 leading-snug">
          {title}
        </div>
      )}
      <div className="text-white/70 whitespace-pre-wrap">{summary}</div>
    </div>
  );
}

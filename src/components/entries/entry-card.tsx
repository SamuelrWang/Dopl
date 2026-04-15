"use client";

import { useState } from "react";
import { GlassCard, MonoLabel } from "@/components/design";
import {
  addEntryPanelToCanvas,
  fetchFullEntry,
} from "@/components/canvas/add-to-canvas";

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


const complexityAccent: Record<string, string> = {
  simple: "var(--mint)",
  moderate: "var(--gold)",
  complex: "var(--coral)",
  advanced: "var(--coral)",
};

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

export function EntryCard({
  id,
  title,
  summary,
  sourceUrl,
  sourcePlatform,
  thumbnailUrl,
  useCase,
  complexity,
  status,
  createdAt,
}: EntryCardProps) {
  const platform = sourcePlatform || "web";
  const gradientClass = placeholderGradients[platform] || placeholderGradients.web;
  const accentColor = complexity ? complexityAccent[complexity] : undefined;

  // "Add to canvas" button state:
  //  - idle   → "+" icon
  //  - loading → small spinner/"..." while we fetch the full entry
  //  - added  → checkmark-style confirmation for 1.5s, then back to idle
  //  - error  → "!" briefly, then back to idle
  const [addState, setAddState] = useState<
    "idle" | "loading" | "added" | "error"
  >("idle");

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
    <a href={`/entries/${id}`} target="_blank" rel="noopener" className="group block h-full">
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

          {/* Platform badge — sharp corners, mono label */}
          <div className="absolute top-2 left-2">
            <span className="font-mono text-[9px] uppercase tracking-wider px-1.5 py-0.5 bg-[oklch(0.07_0_0)] border border-white/10 text-white/80 rounded-[3px]">
              {platformLabels[platform] || "Web"}
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
                {status}
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

          {/* Metadata row */}
          <div className="flex items-center gap-3 pt-2 border-t border-white/[0.06]">
            {complexity && (
              <MonoLabel accentColor={accentColor} tone="muted">
                {complexity}
              </MonoLabel>
            )}
            {useCase && !complexity && (
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
    </a>
  );
}

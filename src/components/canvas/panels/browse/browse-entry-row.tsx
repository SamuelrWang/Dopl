"use client";

import { useState } from "react";
import type { BrowseEntry } from "./use-browse-state";

const platformLabels: Record<string, string> = {
  x: "X",
  instagram: "IG",
  reddit: "Reddit",
  github: "GitHub",
  youtube: "YT",
  web: "Web",
};

const placeholderGradients: Record<string, string> = {
  x: "from-neutral-900 to-black",
  instagram: "from-fuchsia-900 via-pink-900 to-orange-900",
  reddit: "from-orange-900 to-red-950",
  github: "from-neutral-800 to-neutral-900",
  youtube: "from-red-900 to-red-950",
  web: "from-slate-900 to-black",
};

interface BrowseEntryCardProps {
  entry: BrowseEntry;
  onAdd: (entryId: string) => void;
  adding?: boolean;
}

function formatDate(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

export function BrowseEntryCard({ entry, onAdd, adding }: BrowseEntryCardProps) {
  const platform = entry.source_platform || "web";
  const label = platformLabels[platform] || platform;
  const gradient = placeholderGradients[platform] || placeholderGradients.web;
  const [imgError, setImgError] = useState(false);

  return (
    <button
      type="button"
      onClick={() => onAdd(entry.id)}
      disabled={adding}
      className="w-full text-left rounded-[6px] overflow-hidden bg-white/[0.03] border border-white/[0.08] hover:bg-white/[0.06] hover:border-white/[0.14] transition-all cursor-pointer disabled:opacity-50 disabled:cursor-wait group"
    >
      {/* Thumbnail */}
      <div className="relative aspect-[16/9] overflow-hidden">
        {entry.thumbnail_url && !imgError ? (
          <img
            src={entry.thumbnail_url}
            alt={entry.title || "Entry thumbnail"}
            className="w-full h-full object-cover group-hover:scale-[1.02] transition-transform duration-300"
            loading="lazy"
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

        {/* Similarity badge (search mode) */}
        {entry.similarity != null && (
          <div className="absolute top-1.5 right-1.5">
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
    </button>
  );
}

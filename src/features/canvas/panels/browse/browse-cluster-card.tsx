"use client";

/**
 * BrowseClusterCard — grid tile for a shared (published) cluster inside the
 * canvas Browse panel. Mirrors the public CommunityCard visual grammar but
 * its primary action imports the cluster onto the user's canvas rather than
 * navigating away.
 */

import { Check, ExternalLink, GitFork, Plus } from "lucide-react";
import type { BrowseCluster } from "./use-browse-state";

interface BrowseClusterCardProps {
  cluster: BrowseCluster;
  onImport: (slug: string) => void;
  importing: boolean;
  imported: boolean;
}

export function BrowseClusterCard({
  cluster,
  onImport,
  importing,
  imported,
}: BrowseClusterCardProps) {
  return (
    <div className="flex flex-col rounded-[6px] overflow-hidden bg-white/[0.03] border border-white/[0.08] hover:border-white/[0.16] transition-colors">
      {/* Thumbnail — the community OG image route, so tiles match the
          social-preview card for the same shared cluster. */}
      <div className="relative aspect-[16/9] overflow-hidden bg-white/[0.04]">
        <img
          src={`/community/${cluster.slug}/opengraph-image`}
          alt=""
          loading="lazy"
          className="w-full h-full object-cover"
        />
        {cluster.category && (
          <span className="absolute top-1.5 right-1.5 font-mono text-[8px] uppercase tracking-wider px-1.5 py-0.5 bg-[oklch(0.07_0_0)] border border-white/10 text-white/80 rounded-[3px]">
            {cluster.category}
          </span>
        )}
      </div>

      {/* Body */}
      <div className="flex flex-col flex-1 px-2.5 py-2 gap-1.5">
        <div className="flex items-start justify-between gap-1.5">
          <h3 className="text-[12px] font-medium leading-snug text-white/90 line-clamp-2">
            {cluster.title}
          </h3>
          <a
            href={`/community/${cluster.slug}`}
            target="_blank"
            rel="noopener"
            className="shrink-0 mt-0.5 text-white/30 hover:text-white/70 transition-colors"
            aria-label="View shared cluster on community"
            title="View on community"
          >
            <ExternalLink size={12} />
          </a>
        </div>

        {cluster.description && (
          <p className="text-[11px] leading-relaxed text-white/45 line-clamp-2">
            {cluster.description}
          </p>
        )}

        {/* Meta: author + entry count + import count */}
        <div className="mt-auto flex items-center gap-2 pt-1 text-white/35">
          <span className="font-mono text-[9px] truncate flex-1">
            {cluster.author_name || "Anonymous"}
          </span>
          <span className="font-mono text-[9px]">
            {cluster.panel_count}{" "}
            {cluster.panel_count === 1 ? "entry" : "entries"}
          </span>
          {cluster.fork_count > 0 && (
            <span className="flex items-center gap-0.5 font-mono text-[9px]">
              <GitFork size={9} />
              {cluster.fork_count}
            </span>
          )}
        </div>

        {/* Primary action — import the cluster onto the canvas. */}
        <button
          type="button"
          onClick={() => onImport(cluster.slug)}
          disabled={importing || imported}
          className="mt-1 inline-flex h-6 items-center justify-center gap-1 rounded-[3px] border border-white/[0.12] bg-white/[0.04] font-mono text-[9px] uppercase tracking-wide text-white/70 hover:text-white/95 hover:border-white/[0.22] hover:bg-white/[0.08] disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        >
          {imported ? (
            <>
              <Check size={10} /> Imported
            </>
          ) : importing ? (
            "Importing..."
          ) : (
            <>
              <Plus size={10} /> Import to canvas
            </>
          )}
        </button>
      </div>
    </div>
  );
}

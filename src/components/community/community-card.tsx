"use client";

/**
 * CommunityCard — grid tile for a published cluster. Anatomy mirrors
 * EntryCard so the two feel like siblings on the Browse page:
 *
 *  1. Thumbnail strip (16:10) with category pill overlay — served by
 *     the dynamic /community/<slug>/opengraph-image route so the tile
 *     matches what X / Slack / iMessage show for the same URL.
 *  2. Body:
 *       - Title (clamp 2 lines)
 *       - Description clamp (new — was missing)
 *       - Author row (avatar + name + import count)
 *       - Meta footer with bookmark toggle + date
 */

import Link from "next/link";
import { Bookmark, GitFork } from "lucide-react";
import { GlassCard, MonoLabel } from "@/components/design";
import { useSavedToggle } from "@/lib/saved/local-store";
import type { PublishedClusterSummary } from "@/features/community/server/types";

interface CommunityCardProps {
  cluster: PublishedClusterSummary;
}

export function CommunityCard({ cluster }: CommunityCardProps) {
  const { saved, toggle } = useSavedToggle("cluster", cluster.slug);

  function handleBookmarkClick(e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    toggle();
  }

  return (
    // Wrapping Link gives us automatic hover prefetch + new-tab open.
    // The bookmark button inside intercepts its own click via
    // stopPropagation so it doesn't navigate.
    <Link
      href={`/community/${cluster.slug}`}
      target="_blank"
      rel="noopener"
      className="group block h-full"
    >
      <GlassCard
        variant="subtle"
        className="h-full !p-0 overflow-hidden hover:bg-white/[0.10] transition-colors cursor-pointer"
      >
        {/* Thumbnail — rendered by the OG route so every card matches
            the social-preview card. */}
        <div className="relative aspect-[16/10] overflow-hidden">
          <img
            src={`/community/${cluster.slug}/opengraph-image`}
            alt=""
            loading="lazy"
            className="w-full h-full object-cover group-hover:scale-[1.02] transition-transform duration-300"
          />
          {cluster.category && (
            <span className="absolute top-2 right-2 font-mono text-[9px] uppercase tracking-wider px-1.5 py-0.5 bg-[oklch(0.07_0_0)] border border-white/10 text-white/80 rounded-[3px]">
              {cluster.category}
            </span>
          )}
        </div>

        {/* Content */}
        <div className="p-4 space-y-3">
          {/* Title */}
          <h3 className="font-medium text-sm line-clamp-2 leading-snug text-white/90 group-hover:text-white transition-colors">
            {cluster.title}
          </h3>

          {/* Description */}
          {cluster.description && (
            <p className="text-xs text-white/50 line-clamp-2 leading-relaxed">
              {cluster.description}
            </p>
          )}

          {/* Author + import count row */}
          <div className="flex items-center gap-2 min-w-0">
            {cluster.author.avatar_url ? (
              <img
                src={cluster.author.avatar_url}
                alt=""
                className="w-5 h-5 rounded-full flex-shrink-0"
              />
            ) : (
              <div className="w-5 h-5 rounded-full bg-neutral-700 flex-shrink-0" />
            )}
            <span className="text-[12px] text-white/40 truncate flex-1">
              {cluster.author.display_name || "Anonymous"}
            </span>
            {cluster.fork_count > 0 && (
              <span className="flex items-center gap-1 text-white/30 flex-shrink-0">
                <GitFork size={11} />
                <span className="font-mono text-[10px]">{cluster.fork_count}</span>
              </span>
            )}
          </div>

          {/* Meta footer: bookmark toggle + panel count + date. Same
              visual grammar as EntryCard's bottom row. */}
          <div className="flex items-center gap-3 pt-2 border-t border-white/[0.06]">
            <button
              onClick={handleBookmarkClick}
              aria-label={saved ? "Remove from saved" : "Save for later"}
              title={saved ? "Saved" : "Save"}
              className={`inline-flex items-center justify-center w-7 h-7 rounded-[3px] border transition-colors ${
                saved
                  ? "bg-white/[0.08] border-white/[0.2] text-white"
                  : "bg-transparent border-white/[0.08] text-white/40 hover:text-white/80 hover:bg-white/[0.04] hover:border-white/[0.15]"
              }`}
            >
              <Bookmark
                size={13}
                strokeWidth={1.75}
                fill={saved ? "currentColor" : "none"}
              />
            </button>
            <MonoLabel tone="muted">
              {cluster.panel_count}{" "}
              {cluster.panel_count === 1 ? "entry" : "entries"}
            </MonoLabel>
            <span className="font-mono text-[10px] text-white/30 ml-auto">
              {new Date(cluster.created_at).toLocaleDateString("en-US", {
                month: "short",
                day: "numeric",
              })}
            </span>
          </div>
        </div>
      </GlassCard>
    </Link>
  );
}

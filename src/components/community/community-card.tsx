"use client";

import Link from "next/link";
import type { PublishedClusterSummary } from "@/lib/community/types";

interface CommunityCardProps {
  cluster: PublishedClusterSummary;
}

export function CommunityCard({ cluster }: CommunityCardProps) {
  return (
    // next/link with target="_blank" gives us both:
    //   - New-tab open (current page stays put — matches EntryCard)
    //   - Automatic prefetch on hover in production, which warms Next's
    //     Full Route Cache. Combined with the React cache() dedupe in
    //     /community/[slug]/page.tsx, the cold-open of a cluster after
    //     a ~200ms hover is usually instant.
    <Link
      href={`/community/${cluster.slug}`}
      target="_blank"
      rel="noopener"
      className="group cursor-pointer block"
    >
      {/* Thumbnail */}
      <div className="aspect-[16/10] bg-neutral-900 rounded-xl mb-3 border border-white/[0.06] overflow-hidden group-hover:border-white/[0.12] transition-colors relative">
        {cluster.thumbnail_url ? (
          <img
            src={cluster.thumbnail_url}
            alt=""
            className="w-full h-full object-cover"
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center">
            <div className="text-white/10 text-xs font-mono uppercase tracking-wider">
              {cluster.panel_count} entries
            </div>
          </div>
        )}
        {/* Category pill */}
        {cluster.category && (
          <span className="absolute top-2 right-2 px-2 py-0.5 rounded-full text-[10px] font-mono uppercase tracking-wider bg-[oklch(0.07_0_0)] text-white/50 border border-white/[0.08]">
            {cluster.category}
          </span>
        )}
      </div>

      {/* Title */}
      <h3 className="text-white text-[14px] font-medium mb-1.5 line-clamp-1 group-hover:text-white/90 transition-colors">
        {cluster.title}
      </h3>

      {/* Author + stats row */}
      <div className="flex items-center justify-between">
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
          <span className="text-white/40 text-[13px] truncate">
            {cluster.author.display_name || "Anonymous"}
          </span>
        </div>

        {cluster.fork_count > 0 && (
          <div className="flex items-center gap-1 text-white/30 flex-shrink-0">
            <svg
              width="12"
              height="12"
              viewBox="0 0 16 16"
              fill="currentColor"
              aria-hidden
            >
              <path d="M5 3.25a.75.75 0 1 1-1.5 0 .75.75 0 0 1 1.5 0Zm0 2.122a2.25 2.25 0 1 0-1.5 0v.878A2.25 2.25 0 0 0 5.75 8.5h1.5v2.128a2.251 2.251 0 1 0 1.5 0V8.5h1.5a2.25 2.25 0 0 0 2.25-2.25v-.878a2.25 2.25 0 1 0-1.5 0v.878a.75.75 0 0 1-.75.75h-4.5A.75.75 0 0 1 5 6.25v-.878Zm3.75 7.378a.75.75 0 1 1-1.5 0 .75.75 0 0 1 1.5 0Zm3-8.75a.75.75 0 1 0 0-1.5.75.75 0 0 0 0 1.5Z" />
            </svg>
            <span className="text-[12px]">{cluster.fork_count}</span>
          </div>
        )}
      </div>
    </Link>
  );
}

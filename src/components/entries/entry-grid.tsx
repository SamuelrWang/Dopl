"use client";

import { EntryCard } from "./entry-card";
import { GlassCard } from "@/components/design";

interface EntryGridEntry {
  id: string;
  title: string | null;
  summary: string | null;
  source_url: string;
  source_platform: string | null;
  thumbnail_url: string | null;
  use_case: string | null;
  complexity: string | null;
  content_type: string | null;
  status: string;
  created_at: string;
}

interface EntryGridProps {
  entries: EntryGridEntry[];
}

// Same responsive column breakpoints used for both the populated and
// loading states so the viewport's card count is stable while loading.
const GRID_CLASSES =
  "grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4";

export function EntryGrid({ entries }: EntryGridProps) {
  if (entries.length === 0) {
    return (
      <GlassCard variant="subtle" className="text-center py-16">
        <p className="font-mono text-[10px] uppercase tracking-wide text-white/40">
          No entries yet
        </p>
        <p className="text-xs text-white/30 mt-2">
          Start by ingesting your first setup post
        </p>
      </GlassCard>
    );
  }

  return (
    <div className={GRID_CLASSES}>
      {entries.map((entry) => (
        <EntryCard
          key={entry.id}
          id={entry.id}
          title={entry.title}
          summary={entry.summary}
          sourceUrl={entry.source_url}
          sourcePlatform={entry.source_platform}
          thumbnailUrl={entry.thumbnail_url}
          useCase={entry.use_case}
          complexity={entry.complexity}
          status={entry.status}
          createdAt={entry.created_at}
        />
      ))}
    </div>
  );
}

/**
 * Placeholder grid rendered while entries are loading. Mirrors the
 * shape of a real EntryCard (thumbnail / title / summary / url /
 * metadata row) so the layout doesn't jump when real content arrives.
 *
 * `count` defaults to 8 (two rows on xl). Keep it modest — we don't
 * know how many real entries are coming and an oversize skeleton
 * scrolls further than the final page often does.
 */
export function EntryGridSkeleton({ count = 8 }: { count?: number }) {
  return (
    <div className={GRID_CLASSES}>
      {Array.from({ length: count }, (_, i) => (
        <EntryCardSkeleton key={i} />
      ))}
    </div>
  );
}

/**
 * Single skeleton card — internal, not exported. Structure kept in
 * sync with EntryCard so the crossfade to real content is seamless.
 * All shimmer comes from Tailwind's animate-pulse on white/10 fills;
 * no additional keyframes needed.
 */
function EntryCardSkeleton() {
  return (
    <GlassCard
      variant="subtle"
      className="h-full !p-0 overflow-hidden pointer-events-none"
    >
      {/* Thumbnail */}
      <div className="aspect-video bg-white/[0.04] animate-pulse" />

      {/* Content */}
      <div className="p-4 space-y-3">
        {/* Title — two lines, second shorter */}
        <div className="space-y-1.5">
          <div className="h-3.5 w-[85%] rounded bg-white/[0.06] animate-pulse" />
          <div className="h-3.5 w-[55%] rounded bg-white/[0.06] animate-pulse" />
        </div>

        {/* Summary — two dimmer lines */}
        <div className="space-y-1.5">
          <div className="h-2.5 w-full rounded bg-white/[0.04] animate-pulse" />
          <div className="h-2.5 w-[70%] rounded bg-white/[0.04] animate-pulse" />
        </div>

        {/* Source URL */}
        <div className="h-2.5 w-[45%] rounded bg-white/[0.03] animate-pulse" />

        {/* Metadata row: bookmark-sized icon + tag + date */}
        <div className="flex items-center gap-3 pt-2 border-t border-white/[0.06]">
          <div className="w-4 h-4 rounded bg-white/[0.05] animate-pulse" />
          <div className="h-2.5 w-16 rounded bg-white/[0.04] animate-pulse" />
          <div className="h-2.5 w-10 rounded bg-white/[0.04] animate-pulse ml-auto" />
        </div>
      </div>
    </GlassCard>
  );
}

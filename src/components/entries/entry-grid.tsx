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
  status: string;
  created_at: string;
}

interface EntryGridProps {
  entries: EntryGridEntry[];
}

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
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
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

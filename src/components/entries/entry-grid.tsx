"use client";

import { EntryCard } from "./entry-card";

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
      <div className="text-center py-12 text-muted-foreground">
        <p className="text-lg">No entries yet</p>
        <p className="text-sm mt-1">
          Start by ingesting your first setup post
        </p>
      </div>
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

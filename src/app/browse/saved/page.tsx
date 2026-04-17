"use client";

/**
 * Saved tab — shows entries and clusters the user has bookmarked.
 *
 * Storage: localStorage (see src/lib/saved/local-store.ts). Reads the
 * saved id + slug lists, then fetches full records from the existing
 * listing endpoints (`/api/entries`, `/api/community`) and filters
 * down. Filter-client-side is fine while saved lists stay small;
 * when we move to a server-side `user_saved_items` table, this page
 * can swap to a single `/api/saved` call without touching the cards.
 */

import { useEffect, useMemo, useState } from "react";
import { EntryGrid } from "@/components/entries/entry-grid";
import { CommunityCard } from "@/components/community/community-card";
import { GlassCard, MonoLabel } from "@/components/design";
import { useSavedList } from "@/lib/saved/local-store";
import type { PublishedClusterSummary } from "@/lib/community/types";

interface EntryListItem {
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

export default function SavedPage() {
  const saved = useSavedList();
  const [entries, setEntries] = useState<EntryListItem[]>([]);
  const [clusters, setClusters] = useState<PublishedClusterSummary[]>([]);
  const [loading, setLoading] = useState(true);

  // Fetch every entry + cluster once, then keep filtering locally as
  // the user toggles saves. Cheap: both endpoints already back the
  // main browse tabs and are edge-cacheable.
  useEffect(() => {
    let cancelled = false;
    async function fetchAll() {
      setLoading(true);
      try {
        const [entriesRes, clustersRes] = await Promise.all([
          fetch("/api/entries?status=complete").then((r) =>
            r.ok ? r.json() : { entries: [] }
          ),
          fetch("/api/community?limit=100&sort=popular").then((r) =>
            r.ok ? r.json() : { items: [] }
          ),
        ]);
        if (cancelled) return;
        setEntries(Array.isArray(entriesRes.entries) ? entriesRes.entries : []);
        setClusters(Array.isArray(clustersRes.items) ? clustersRes.items : []);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    fetchAll();
    return () => {
      cancelled = true;
    };
  }, []);

  const savedEntrySet = useMemo(() => new Set(saved.entries), [saved.entries]);
  const savedClusterSet = useMemo(
    () => new Set(saved.clusters),
    [saved.clusters]
  );

  const savedEntries = useMemo(
    () => entries.filter((e) => savedEntrySet.has(e.id)),
    [entries, savedEntrySet]
  );
  const savedClusters = useMemo(
    () => clusters.filter((c) => savedClusterSet.has(c.slug)),
    [clusters, savedClusterSet]
  );

  const totalSaved = savedEntries.length + savedClusters.length;

  if (loading) {
    return (
      <GlassCard
        variant="subtle"
        className="flex items-center justify-center h-64"
      >
        <p className="font-mono text-[10px] uppercase tracking-wide text-white/40">
          Loading saved items...
        </p>
      </GlassCard>
    );
  }

  if (totalSaved === 0) {
    return (
      <GlassCard variant="subtle" className="text-center py-16">
        <p className="font-mono text-[10px] uppercase tracking-wide text-white/40">
          No saved items yet
        </p>
        <p className="text-xs text-white/30 mt-2">
          Click the bookmark icon on any entry or cluster to save it here.
        </p>
      </GlassCard>
    );
  }

  return (
    <div className="space-y-8">
      {savedClusters.length > 0 && (
        <section className="space-y-3">
          <MonoLabel tone="muted">
            Saved clusters ({savedClusters.length})
          </MonoLabel>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
            {savedClusters.map((c) => (
              <CommunityCard key={c.id} cluster={c} />
            ))}
          </div>
        </section>
      )}

      {savedEntries.length > 0 && (
        <section className="space-y-3">
          <MonoLabel tone="muted">
            Saved entries ({savedEntries.length})
          </MonoLabel>
          <EntryGrid entries={savedEntries} />
        </section>
      )}
    </div>
  );
}

"use client";

import { useCallback, useEffect, useState } from "react";
import { CommunityCard } from "@/components/community/community-card";
import { GlassCard } from "@/components/design";
import type { PublishedClusterSummary } from "@/lib/community/types";

export default function BrowseClustersPage() {
  const [clusters, setClusters] = useState<PublishedClusterSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const fetchClusters = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const params = new URLSearchParams({ limit: "24", sort: "popular" });
      const res = await fetch(`/api/community?${params}`);
      if (!res.ok) throw new Error(`Failed to load clusters (HTTP ${res.status})`);
      const data = await res.json();
      setClusters(Array.isArray(data.items) ? data.items : []);
    } catch (err) {
      console.error("Failed to fetch clusters:", err);
      setLoadError(
        err instanceof Error ? err.message : "Failed to load clusters"
      );
      setClusters([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchClusters();
  }, [fetchClusters]);

  if (loading) {
    return (
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
        {Array.from({ length: 8 }).map((_, i) => (
          <div key={i} className="animate-pulse">
            <div className="aspect-[16/10] bg-white/[0.04] rounded-xl mb-3" />
            <div className="h-4 w-3/4 bg-white/[0.04] rounded mb-2" />
            <div className="h-3 w-1/2 bg-white/[0.04] rounded" />
          </div>
        ))}
      </div>
    );
  }

  if (loadError) {
    return (
      <GlassCard
        variant="subtle"
        className="flex flex-col items-center justify-center h-64 gap-3"
      >
        <p className="text-sm text-red-400">{loadError}</p>
        <button
          onClick={fetchClusters}
          className="font-mono text-[10px] uppercase tracking-wide text-white/60 hover:text-white/90 border border-white/[0.15] rounded-[3px] px-3 py-1.5"
        >
          Retry
        </button>
      </GlassCard>
    );
  }

  if (clusters.length === 0) {
    return (
      <GlassCard variant="subtle" className="text-center py-16">
        <p className="font-mono text-[10px] uppercase tracking-wide text-white/40">
          No published clusters yet
        </p>
        <p className="text-xs text-white/30 mt-2">
          Be the first to publish a cluster from /canvas
        </p>
      </GlassCard>
    );
  }

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
      {clusters.map((c) => (
        <CommunityCard key={c.id} cluster={c} />
      ))}
    </div>
  );
}

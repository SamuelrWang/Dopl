"use client";

import { useEffect, useState, useCallback } from "react";
import { EntryGrid } from "@/components/entries/entry-grid";
import { SmartChatPanel } from "@/components/entries/smart-chat-panel";
import { CommunityCard } from "@/components/community/community-card";
import { GlassCard, MonoLabel } from "@/components/design";
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

interface PendingIngest {
  entry_id: string;
  url: string;
  queued_at: string;
}

type Tab = "entries" | "clusters";

export default function EntriesPage() {
  const [tab, setTab] = useState<Tab>("entries");

  // ── Entries tab state ──
  const [entries, setEntries] = useState<EntryListItem[]>([]);
  const [pending, setPending] = useState<PendingIngest[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [useCase, setUseCase] = useState("all");
  const [complexity, setComplexity] = useState("all");

  // ── Clusters tab state ──
  const [clusters, setClusters] = useState<PublishedClusterSummary[]>([]);
  const [clustersLoading, setClustersLoading] = useState(false);
  const [clustersError, setClustersError] = useState<string | null>(null);

  const fetchEntries = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const params = new URLSearchParams();
      params.set("status", "complete");
      if (useCase !== "all") params.set("use_case", useCase);
      if (complexity !== "all") params.set("complexity", complexity);

      const res = await fetch(`/api/entries?${params}`);
      if (!res.ok) {
        throw new Error(`Failed to load entries (HTTP ${res.status})`);
      }
      const data = await res.json();
      setEntries(Array.isArray(data.entries) ? data.entries : []);
    } catch (err) {
      console.error("Failed to fetch entries:", err);
      setLoadError(err instanceof Error ? err.message : "Failed to load entries");
      setEntries([]);
    } finally {
      setLoading(false);
    }
  }, [useCase, complexity]);

  useEffect(() => {
    fetchEntries();
  }, [fetchEntries]);

  // Fetch the caller's pending queue (skeleton entries waiting for
  // their MCP agent). Re-fetched when entries reload so the strip
  // updates if a pending row gets claimed while the page is open.
  useEffect(() => {
    let cancelled = false;
    fetch("/api/ingest/pending")
      .then(async (r) => (r.ok ? r.json() : { recent: [] }))
      .then((data) => {
        if (cancelled) return;
        setPending(Array.isArray(data?.recent) ? data.recent : []);
      })
      .catch(() => {
        if (!cancelled) setPending([]);
      });
    return () => {
      cancelled = true;
    };
  }, [entries.length]);

  // Load clusters lazily the first time the user clicks the Clusters tab.
  const fetchClusters = useCallback(async () => {
    setClustersLoading(true);
    setClustersError(null);
    try {
      const params = new URLSearchParams({ limit: "24", sort: "popular" });
      const res = await fetch(`/api/community?${params}`);
      if (!res.ok) {
        throw new Error(`Failed to load clusters (HTTP ${res.status})`);
      }
      const data = await res.json();
      setClusters(Array.isArray(data.items) ? data.items : []);
    } catch (err) {
      console.error("Failed to fetch clusters:", err);
      setClustersError(
        err instanceof Error ? err.message : "Failed to load clusters"
      );
      setClusters([]);
    } finally {
      setClustersLoading(false);
    }
  }, []);

  useEffect(() => {
    if (tab === "clusters" && clusters.length === 0 && !clustersLoading && !clustersError) {
      fetchClusters();
    }
  }, [tab, clusters.length, clustersLoading, clustersError, fetchClusters]);

  return (
    <div className="flex flex-col h-[calc(100vh-100px)]">
      {/* Tab switcher */}
      <div className="flex items-center gap-1 mb-4 shrink-0">
        <TabButton active={tab === "entries"} onClick={() => setTab("entries")}>
          Entries
        </TabButton>
        <TabButton active={tab === "clusters"} onClick={() => setTab("clusters")}>
          Clusters
        </TabButton>
      </div>

      {/* Body: 2-column layout. Left = SmartChatPanel (fixed size,
          scrolls inside), right = the active tab's content. */}
      <div className="flex gap-4 flex-1 min-h-0">
        <aside className="w-[320px] shrink-0 hidden md:block h-full">
          <SmartChatPanel
            useCase={useCase}
            complexity={complexity}
            onUseCaseChange={(v) => setUseCase(v || "all")}
            onComplexityChange={(v) => setComplexity(v || "all")}
            onReset={() => {
              setUseCase("all");
              setComplexity("all");
            }}
          />
        </aside>

        <div className="flex-1 min-w-0 overflow-y-auto pr-1">
          {tab === "entries" ? (
            <EntriesView
              entries={entries}
              pending={pending}
              loading={loading}
              loadError={loadError}
              onRetry={fetchEntries}
            />
          ) : (
            <ClustersView
              clusters={clusters}
              loading={clustersLoading}
              loadError={clustersError}
              onRetry={fetchClusters}
            />
          )}
        </div>
      </div>
    </div>
  );
}

// ── Tab button ───────────────────────────────────────────────────────

function TabButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={`h-8 px-4 font-mono text-[11px] uppercase tracking-wider rounded-[3px] border transition-colors ${
        active
          ? "bg-white/[0.08] border-white/[0.18] text-white/90"
          : "bg-transparent border-white/[0.06] text-white/40 hover:text-white/70 hover:bg-white/[0.04]"
      }`}
    >
      {children}
    </button>
  );
}

// ── Entries tab body ─────────────────────────────────────────────────

function EntriesView({
  entries,
  pending,
  loading,
  loadError,
  onRetry,
}: {
  entries: EntryListItem[];
  pending: PendingIngest[];
  loading: boolean;
  loadError: string | null;
  onRetry: () => void;
}) {
  return (
    <div className="space-y-4">
      {pending.length > 0 && (
        <GlassCard
          variant="subtle"
          className="!p-4 border border-amber-500/20 bg-amber-500/[0.04]"
        >
          <div className="flex items-center justify-between mb-3">
            <MonoLabel tone="muted" accentColor="rgb(245,158,11)">
              Your queued URLs ({pending.length})
            </MonoLabel>
            <span className="text-[10px] text-amber-300/60 font-mono uppercase tracking-wide">
              Waiting for your agent
            </span>
          </div>
          <ul className="space-y-1.5">
            {pending.map((p) => (
              <li
                key={p.entry_id}
                className="flex items-center gap-3 text-xs text-white/70"
              >
                <span className="font-mono text-[10px] text-amber-400/80 shrink-0">
                  ●
                </span>
                <a
                  href={p.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="truncate hover:text-white/90 transition-colors"
                  title={p.url}
                >
                  {p.url}
                </a>
                <span className="ml-auto text-[10px] text-white/30 font-mono shrink-0">
                  {new Date(p.queued_at).toLocaleTimeString([], {
                    hour: "numeric",
                    minute: "2-digit",
                  })}
                </span>
              </li>
            ))}
          </ul>
          <p className="mt-3 text-[10px] text-white/40 leading-relaxed">
            These URLs will be processed the next time your connected MCP
            agent calls a Dopl tool.
          </p>
        </GlassCard>
      )}

      {loading ? (
        <GlassCard variant="subtle" className="flex items-center justify-center h-64">
          <p className="font-mono text-[10px] uppercase tracking-wide text-white/40">
            Loading entries...
          </p>
        </GlassCard>
      ) : loadError ? (
        <GlassCard
          variant="subtle"
          className="flex flex-col items-center justify-center h-64 gap-3"
        >
          <p className="text-sm text-red-400">{loadError}</p>
          <button
            onClick={onRetry}
            className="font-mono text-[10px] uppercase tracking-wide text-white/60 hover:text-white/90 border border-white/[0.15] rounded-[3px] px-3 py-1.5"
          >
            Retry
          </button>
        </GlassCard>
      ) : (
        <EntryGrid entries={entries} />
      )}
    </div>
  );
}

// ── Clusters tab body ────────────────────────────────────────────────

function ClustersView({
  clusters,
  loading,
  loadError,
  onRetry,
}: {
  clusters: PublishedClusterSummary[];
  loading: boolean;
  loadError: string | null;
  onRetry: () => void;
}) {
  if (loading) {
    return (
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-5">
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
          onClick={onRetry}
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
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-5">
      {clusters.map((c) => (
        <CommunityCard key={c.id} cluster={c} />
      ))}
    </div>
  );
}

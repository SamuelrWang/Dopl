"use client";

import { useCallback, useEffect, useState } from "react";
import { EntryGrid, EntryGridSkeleton } from "@/components/entries/entry-grid";
import { GlassCard, MonoLabel } from "@/components/design";

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

export default function BrowseEntriesPage() {
  const [entries, setEntries] = useState<EntryListItem[]>([]);
  const [pending, setPending] = useState<PendingIngest[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const fetchEntries = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const params = new URLSearchParams();
      params.set("status", "complete");
      const res = await fetch(`/api/entries?${params}`);
      if (!res.ok) throw new Error(`Failed to load entries (HTTP ${res.status})`);
      const data = await res.json();
      setEntries(Array.isArray(data.entries) ? data.entries : []);
    } catch (err) {
      console.error("Failed to fetch entries:", err);
      setLoadError(err instanceof Error ? err.message : "Failed to load entries");
      setEntries([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchEntries();
  }, [fetchEntries]);

  // User's pending queue — skeleton entries waiting for their MCP agent.
  useEffect(() => {
    let cancelled = false;
    fetch("/api/ingest/pending")
      .then(async (r) => (r.ok ? r.json() : { recent: [] }))
      .then((data) => {
        if (!cancelled) {
          setPending(Array.isArray(data?.recent) ? data.recent : []);
        }
      })
      .catch(() => {
        if (!cancelled) setPending([]);
      });
    return () => {
      cancelled = true;
    };
  }, [entries.length]);

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
        <EntryGridSkeleton />
      ) : loadError ? (
        <GlassCard
          variant="subtle"
          className="flex flex-col items-center justify-center h-64 gap-3"
        >
          <p className="text-sm text-red-400">{loadError}</p>
          <button
            onClick={fetchEntries}
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

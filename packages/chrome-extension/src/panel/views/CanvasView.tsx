/**
 * CanvasView — Compact list view of canvas entries with cluster badges.
 */

import { useState, useEffect } from "react";
import { useCanvas } from "../hooks/useCanvas";
import { useBgMessage } from "../hooks/useBgMessage";
import { EntryCard } from "../components/EntryCard";
import { ClusterBadge } from "../components/ClusterBadge";
import { RefreshCw, Layout, FolderOpen } from "lucide-react";
import type { ClusterRow } from "@/shared/types";

export function CanvasView() {
  const { panels, loading, refresh, removeFromCanvas } = useCanvas();
  const { send } = useBgMessage();
  const [clusters, setClusters] = useState<ClusterRow[]>([]);
  const [refreshing, setRefreshing] = useState(false);

  // Load clusters
  useEffect(() => {
    send<ClusterRow[]>({ type: "GET_CLUSTERS" })
      .then(setClusters)
      .catch(() => {});
  }, [send]);

  const handleRefresh = async () => {
    setRefreshing(true);
    await refresh();
    setRefreshing(false);
  };

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2.5 border-b border-[var(--border-default)]">
        <div className="flex items-center gap-2">
          <Layout size={14} className="text-[var(--accent-primary)]" />
          <span className="text-xs font-medium text-[var(--text-primary)]">
            Canvas
          </span>
          <span className="text-[10px] text-[var(--text-muted)]">
            {panels.length} entries
          </span>
        </div>
        <button
          onClick={handleRefresh}
          disabled={refreshing}
          className="p-1.5 rounded text-[var(--text-muted)] hover:text-[var(--text-secondary)] transition-colors"
        >
          <RefreshCw size={12} className={refreshing ? "animate-spin" : ""} />
        </button>
      </div>

      {/* Clusters section */}
      {clusters.length > 0 && (
        <div className="px-3 py-2 border-b border-[var(--border-subtle)]">
          <div className="flex items-center gap-1.5 mb-1.5">
            <FolderOpen size={12} className="text-[var(--text-muted)]" />
            <span className="text-[10px] font-medium text-[var(--text-muted)] uppercase tracking-wide">
              Clusters
            </span>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {clusters.map((cluster) => (
              <ClusterBadge key={cluster.id} name={cluster.name} count={cluster.panel_count} />
            ))}
          </div>
        </div>
      )}

      {/* Entries list */}
      <div className="flex-1 overflow-y-auto p-3 space-y-2">
        {loading ? (
          <div className="flex items-center justify-center h-32">
            <div className="status-dot processing w-3 h-3" />
          </div>
        ) : panels.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-center px-4">
            <Layout size={24} className="text-[var(--text-disabled)] mb-2" />
            <p className="text-xs text-[var(--text-muted)]">No entries on canvas</p>
            <p className="text-[10px] text-[var(--text-disabled)] mt-1">
              Use Search or Ingest to add entries
            </p>
          </div>
        ) : (
          panels.map((panel) => (
            <EntryCard
              key={panel.entry_id}
              entryId={panel.entry_id}
              title={panel.title || "Untitled"}
              summary={panel.summary}
              sourceUrl={panel.source_url}
              onRemoveFromCanvas={removeFromCanvas}
              isOnCanvas
            />
          ))
        )}
      </div>
    </div>
  );
}

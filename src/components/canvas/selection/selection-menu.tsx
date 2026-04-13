"use client";

/**
 * SelectionMenu — floating context menu that appears when 2+ panels are
 * selected. Contains two buttons for v1: Cluster and Delete.
 *
 * Positioning: screen-space overlay below the selection bounding box
 * (computed via useSelectionBounds). Centered horizontally, 12px gap
 * below the selection bottom edge.
 *
 * Actions:
 *   - Cluster → filters out non-clusterable panels (connection), runs
 *     the auto-layout, dispatches CREATE_CLUSTER with a placeholder name,
 *     and clears the selection. The useClusterName hook mounted by
 *     ClusterLayer will asynchronously fetch the AI-generated name.
 *   - Delete → closes every deletable selected panel (connection panel
 *     is pinned and skipped).
 *
 * The menu stops propagation on its own pointerdown so clicks don't
 * accidentally start a marquee or clear the selection.
 */

import { useCanvas } from "../canvas-store";
import type { Cluster } from "../types";
import { isPanelClusterable, isPanelDeletable } from "../types";
import { computeClusterLayout } from "../clusters/cluster-layout";
import { useSelectionBounds } from "./use-selection-bounds";

export function SelectionMenu() {
  const { state, dispatch } = useCanvas();
  const bounds = useSelectionBounds();

  if (!bounds) return null;

  function handleCluster() {
    // Freeze the current selection ids so later dispatches can see it.
    const selectedIds = state.selectedPanelIds;

    // Connection panels can't be clustered — they're pinned singletons
    // that should stay out of multi-panel groupings.
    const clusterCandidates = state.panels.filter(
      (p) => selectedIds.includes(p.id) && isPanelClusterable(p)
    );
    if (clusterCandidates.length < 2) {
      // Nothing to cluster once we strip the non-clusterables.
      dispatch({ type: "SET_SELECTION", panelIds: [] });
      return;
    }

    const moves = computeClusterLayout(clusterCandidates);
    const cluster: Cluster = {
      id: `cluster-${state.nextClusterId}`,
      name: `Cluster ${state.nextClusterId}`,
      panelIds: clusterCandidates.map((p) => p.id),
      createdAt: new Date().toISOString(),
    };
    dispatch({ type: "CREATE_CLUSTER", cluster, moves });
    // Clear the selection so the outline is the only visible affordance.
    dispatch({ type: "SET_SELECTION", panelIds: [] });

    // Sync to DB (fire-and-forget). Only entry panel IDs map to DB entries.
    const entryIds = clusterCandidates
      .filter((p) => p.type === "entry")
      .map((p) => (p as { entryId: string }).entryId);
    fetch("/api/clusters", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: cluster.name, entry_ids: entryIds }),
    })
      .then((res) => res.json())
      .then((data) => {
        if (data.id && data.slug) {
          dispatch({
            type: "UPDATE_CLUSTER_DB_INFO",
            clusterId: cluster.id,
            dbId: data.id,
            slug: data.slug,
          });
        }
      })
      .catch(() => {});
  }

  function handleDelete() {
    const selectedIds = state.selectedPanelIds;
    const deletable = state.panels.filter(
      (p) => selectedIds.includes(p.id) && isPanelDeletable(p)
    );
    for (const p of deletable) {
      dispatch({ type: "CLOSE_PANEL", id: p.id });
    }
    dispatch({ type: "SET_SELECTION", panelIds: [] });
  }

  const left = bounds.left + bounds.width / 2;
  const top = bounds.top + bounds.height + 12;

  return (
    <div
      onPointerDown={(e) => e.stopPropagation()}
      style={{
        position: "absolute",
        left,
        top,
        transform: "translateX(-50%)",
        pointerEvents: "auto",
      }}
      className="z-30"
    >
      <div className="inline-flex items-center gap-1 px-1 h-8 rounded-[4px] bg-black/[0.6] backdrop-blur-md border border-white/[0.12] shadow-[0_4px_16px_rgba(0,0,0,0.4)]">
        <MenuButton label="Cluster" onClick={handleCluster} />
        <div className="w-px h-4 bg-white/[0.12]" aria-hidden />
        <MenuButton label="Delete" tone="danger" onClick={handleDelete} />
      </div>
    </div>
  );
}

function MenuButton({
  label,
  onClick,
  tone = "default",
}: {
  label: string;
  onClick: () => void;
  tone?: "default" | "danger";
}) {
  const colour =
    tone === "danger"
      ? "text-white/70 hover:text-[color:var(--coral)]"
      : "text-white/70 hover:text-white";
  return (
    <button
      type="button"
      onClick={onClick}
      className={`inline-flex items-center h-6 px-3 font-mono text-[10px] uppercase tracking-wider rounded-[3px] hover:bg-white/[0.06] transition-colors ${colour}`}
    >
      {label}
    </button>
  );
}

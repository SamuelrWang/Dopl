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
 *     and clears the selection. Every cluster is a workflow — it gets
 *     a cluster-info panel as its header (createWorkflowCluster).
 *   - Delete → closes every deletable selected panel (connection panel
 *     is pinned and skipped).
 *
 * The menu stops propagation on its own pointerdown so clicks don't
 * accidentally start a marquee or clear the selection.
 */

import { useCanvas, useCanvasScope } from "../canvas-store";
import {
  CLUSTER_INFO_PANEL_SIZE,
  isPanelClusterable,
} from "../types";
import { computeClusterLayout } from "../clusters/cluster-layout";
import { createWorkflowCluster } from "../clusters/create-cluster";

interface SelectionMenuProps {
  cursorPos: { x: number; y: number };
}

export function SelectionMenu({ cursorPos }: SelectionMenuProps) {
  const { state, dispatch } = useCanvas();
  const scope = useCanvasScope();
  const workspaceId = scope?.workspaceId ?? null;

  function handleCluster() {
    // Freeze the current selection ids so later dispatches can see it.
    const selectedIds = state.selectedPanelIds;

    // Connection panels can't be clustered, and cluster-info panels are
    // pinned to their OWN cluster — including one here would dissolve
    // its workflow and strand the card pointing at a deleted cluster.
    const clusterCandidates = state.panels.filter(
      (p) =>
        selectedIds.includes(p.id) &&
        isPanelClusterable(p) &&
        p.type !== "cluster-info"
    );
    if (clusterCandidates.length < 2) {
      // Nothing to cluster once we strip the non-clusterables.
      dispatch({ type: "SET_SELECTION", panelIds: [] });
      return;
    }

    // Compute laid-out positions once (info-panel anchor + chat spawning).
    const moves = computeClusterLayout(clusterCandidates);
    const laidOutPanels = clusterCandidates.map((p) => {
      const move = moves.find((m) => m.id === p.id);
      return move ? { ...p, x: move.x, y: move.y } : p;
    });
    const leftmostX = Math.min(...laidOutPanels.map((p) => p.x));
    const topY = Math.min(...laidOutPanels.map((p) => p.y));

    // Creates the cluster + its info panel atomically, applies the moves,
    // and fire-and-forgets the /api/clusters sync.
    const cluster = createWorkflowCluster({
      state,
      dispatch,
      workspaceId,
      at: {
        x: leftmostX,
        y: topY - CLUSTER_INFO_PANEL_SIZE.height - 48,
      },
      memberPanelIds: clusterCandidates.map((p) => p.id),
      moves,
    });
    // Clear the selection so the outline is the only visible affordance.
    dispatch({ type: "SET_SELECTION", panelIds: [] });

    // ── Auto-spawn a chat panel if the cluster has none ──
    const hasChat = clusterCandidates.some((p) => p.type === "chat");
    if (!hasChat) {
      // +1: the workflow creation consumed state.nextPanelId for the
      // info panel in the same tick.
      const chatPanelId = `panel-${state.nextPanelId + 1}`;

      dispatch({
        type: "CREATE_CHAT_PANEL",
        id: chatPanelId,
        x: leftmostX - 480 - 40,
        y: topY,
        title: "New Chat",
      });
      dispatch({
        type: "ADD_PANEL_TO_CLUSTER",
        panelId: chatPanelId,
        clusterId: cluster.id,
      });
    }
  }

  function handleDelete() {
    // DELETE_SELECTED_PANELS (not a CLOSE_PANEL loop) so the deletion
    // lands on the undo stack — identical to the keyboard Delete path.
    dispatch({ type: "DELETE_SELECTED_PANELS" });
  }

  return (
    <div
      onPointerDown={(e) => e.stopPropagation()}
      style={{
        position: "fixed",
        left: cursorPos.x + 12,
        top: cursorPos.y + 12,
        pointerEvents: "auto",
      }}
      className="z-30"
    >
      <div className="inline-flex items-center gap-1 px-1 h-8 rounded-[4px] bg-[var(--cluster-tab-surface)] border border-border-strong shadow-[0_4px_16px_rgba(0,0,0,0.18)]">
        <MenuButton label="Cluster" onClick={handleCluster} />
        <div className="w-px h-4 bg-border-strong" aria-hidden />
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
      ? "text-text-secondary hover:text-[color:var(--coral)]"
      : "text-text-secondary hover:text-text-primary";
  return (
    <button
      type="button"
      onClick={onClick}
      className={`inline-flex items-center h-6 px-3 font-mono text-[10px] uppercase tracking-wider rounded-[3px] hover:bg-surface-raised-3 transition-colors ${colour}`}
    >
      {label}
    </button>
  );
}

"use client";

/**
 * ClusterLayer — renders all cluster outlines on the canvas.
 *
 * Everything lives in `<ClusterWorldLayer>` inside the world div so it
 * transforms with the panels. The old floating header tab is gone — the
 * cluster-info PANEL (a real canvas panel inside the outline) is the
 * workflow's header now. This layer also upgrades pre-workflow clusters
 * in place: any hydrated cluster without an info panel gets one
 * synthesized at its hull's top-left.
 */

import { useEffect } from "react";
import { useCanvas, useCapabilities, usePanelsContext } from "../canvas-store";
import type { Cluster, ClusterInfoPanelData, Panel } from "../types";
import { CLUSTER_INFO_PANEL_SIZE } from "../types";
import { ClusterOutline } from "./cluster-outline";
import { clusterBounds } from "./cluster-geometry";

/** Resolve a cluster's member panel objects from the current state. */
function getClusterPanels(cluster: Cluster, allPanels: Panel[]): Panel[] {
  const panelMap = new Map(allPanels.map((p) => [p.id, p]));
  const out: Panel[] = [];
  for (const id of cluster.panelIds) {
    const p = panelMap.get(id);
    if (p) out.push(p);
  }
  return out;
}

// ── World-space layer (outlines) ─────────────────────────────────

export function ClusterWorldLayer() {
  const { panels: allPanels, clusters } = usePanelsContext();
  useClusterInfoUpgrade();

  return (
    <>
      {clusters.map((cluster) => {
        const panels = getClusterPanels(cluster, allPanels);
        if (panels.length === 0) return null;
        return <ClusterOutline key={cluster.id} panels={panels} />;
      })}
    </>
  );
}

/**
 * Upgrade-in-place: synthesize a cluster-info panel for every cluster
 * that predates the workflow era (no infoPanelId, or its panel vanished).
 * Ids are allocated with an offset so multiple upgrades in one pass
 * can't collide; the reducer bumps nextPanelId per attach.
 */
function useClusterInfoUpgrade() {
  const { state, dispatch } = useCanvas();
  // Read-only canvases (shared cluster viewer) must not synthesize
  // panels — the upgrade belongs to an editing session.
  const { canMove } = useCapabilities();

  useEffect(() => {
    if (!canMove) return;
    const needsUpgrade = state.clusters.filter(
      (c) =>
        !c.infoPanelId || !state.panels.some((p) => p.id === c.infoPanelId)
    );
    if (needsUpgrade.length === 0) return;

    needsUpgrade.forEach((cluster, i) => {
      const members = state.panels.filter((p) =>
        cluster.panelIds.includes(p.id)
      );
      if (members.length === 0) return;
      const bounds = clusterBounds(members);
      const panel: ClusterInfoPanelData = {
        id: `panel-${state.nextPanelId + i}`,
        type: "cluster-info",
        clusterId: cluster.id,
        x: bounds.x + 16,
        y: bounds.y - CLUSTER_INFO_PANEL_SIZE.height - 24,
        width: CLUSTER_INFO_PANEL_SIZE.width,
        height: CLUSTER_INFO_PANEL_SIZE.height,
      };
      dispatch({
        type: "CLUSTER_ATTACH_INFO_PANEL",
        clusterId: cluster.id,
        panel,
      });
    });
    // Keyed on the cluster list identity — re-runs after hydration and
    // whenever clusters change; the reducer no-ops repeats.
  }, [state.clusters, state.panels, state.nextPanelId, dispatch, canMove]);
}

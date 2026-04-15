"use client";

/**
 * ClusterLayer — renders all clusters on the canvas.
 *
 * Everything lives in `<ClusterWorldLayer>` inside the world div so it
 * transforms with the panels. The header tab uses an inverse scale so its
 * text stays readable at any zoom level while its position is locked to
 * the cluster's bottom-center in world coordinates.
 */

import { usePanelsContext } from "../canvas-store";
import type { Cluster, Panel } from "../types";
import { ClusterOutline } from "./cluster-outline";
import { ClusterHeaderTab } from "./cluster-header-tab";
import { clusterBounds } from "./cluster-geometry";
import { useClusterName } from "./use-cluster-name";

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

// ── World-space layer (outlines + header tabs) ───────────────────

export function ClusterWorldLayer() {
  const { panels: allPanels, clusters } = usePanelsContext();

  return (
    <>
      {clusters.map((cluster) => {
        const panels = getClusterPanels(cluster, allPanels);
        if (panels.length === 0) return null;
        return (
          <ClusterWithHeader
            key={cluster.id}
            cluster={cluster}
            panels={panels}
          />
        );
      })}
    </>
  );
}

/**
 * Wraps ClusterOutline + ClusterHeaderTab + useClusterName so the hook
 * runs once per cluster.
 */
function ClusterWithHeader({
  cluster,
  panels,
}: {
  cluster: Cluster;
  panels: Panel[];
}) {
  useClusterName(cluster);

  const bounds = clusterBounds(panels);
  const worldCenterX = bounds.x + bounds.width / 2;
  const worldBottomY = bounds.y + bounds.height;

  return (
    <>
      <ClusterOutline panels={panels} />
      <ClusterHeaderTab
        cluster={cluster}
        worldX={worldCenterX}
        worldY={worldBottomY}
      />
    </>
  );
}

// ── Screen-space layer (kept as no-op for backward compat) ───────

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function ClusterScreenLayer(_props: { camera: { x: number; y: number; zoom: number } }) {
  // Header tabs are now rendered in the world layer. This is a no-op.
  return null;
}

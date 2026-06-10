"use client";

/**
 * Shared workflow-cluster creation + DB sync. Used by:
 *   - the canvas context menu ("New cluster" — empty workflow at a point)
 *   - the selection menu ("Cluster" — wrap the selected panels)
 *
 * Every cluster is a workflow: it's born with its cluster-info panel
 * (CREATE_CLUSTER_WORKFLOW) and synced to /api/clusters fire-and-forget,
 * backfilling dbId/slug via UPDATE_CLUSTER_DB_INFO on response.
 */

import type { Dispatch } from "react";
import { toast } from "@/shared/ui/toast";
import type {
  CanvasAction,
  CanvasState,
  Cluster,
  ClusterInfoPanelData,
} from "../types";
import { CLUSTER_INFO_PANEL_SIZE } from "../types";

interface CreateArgs {
  state: CanvasState;
  dispatch: Dispatch<CanvasAction>;
  workspaceId: string | null;
  /** World-space anchor — the info panel's top-left. */
  at: { x: number; y: number };
  /** Existing panels to wrap (selection flow). Empty = blank workflow. */
  memberPanelIds?: string[];
  /** Atomic layout moves applied with the creation (selection flow). */
  moves?: Array<{ id: string; x: number; y: number }>;
}

/** Create a workflow cluster + info panel and kick off the DB sync. */
export function createWorkflowCluster({
  state,
  dispatch,
  workspaceId,
  at,
  memberPanelIds = [],
  moves,
}: CreateArgs): Cluster {
  const infoPanelId = `panel-${state.nextPanelId}`;
  const infoPanel: ClusterInfoPanelData = {
    id: infoPanelId,
    type: "cluster-info",
    clusterId: `cluster-${state.nextClusterId}`,
    x: at.x,
    y: at.y,
    width: CLUSTER_INFO_PANEL_SIZE.width,
    height: CLUSTER_INFO_PANEL_SIZE.height,
  };
  const cluster: Cluster = {
    id: `cluster-${state.nextClusterId}`,
    // Already in the server's canonical UPPER_SNAKE form — the API
    // normalizes names on write, and seeding the normalized form keeps
    // the store and the clusters row byte-identical (no silent drift).
    name: `CLUSTER_${state.nextClusterId}`,
    panelIds: [infoPanelId, ...memberPanelIds],
    createdAt: new Date().toISOString(),
    description: null,
    infoPanelId,
  };

  dispatch({ type: "CREATE_CLUSTER_WORKFLOW", cluster, infoPanel, moves });
  syncClusterToDb(dispatch, workspaceId, cluster);
  return cluster;
}

/** POST the cluster row and backfill dbId/slug into the store. */
export function syncClusterToDb(
  dispatch: Dispatch<CanvasAction>,
  workspaceId: string | null,
  cluster: Cluster
): void {
  const headers: Record<string, string> = {
    "content-type": "application/json",
  };
  if (workspaceId) headers["X-Workspace-Id"] = workspaceId;
  fetch("/api/clusters", {
    method: "POST",
    headers,
    body: JSON.stringify({
      name: cluster.name,
      description: cluster.description ?? undefined,
    }),
  })
    .then((res) => {
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return res.json();
    })
    .then((data: { id?: string; slug?: string }) => {
      if (data.id && data.slug) {
        dispatch({
          type: "UPDATE_CLUSTER_DB_INFO",
          clusterId: cluster.id,
          dbId: data.id,
          slug: data.slug,
        });
      } else {
        throw new Error("Cluster create returned no id/slug");
      }
    })
    .catch((err) => {
      console.error("[create-cluster] cluster DB sync failed:", err);
      // The local cluster stays usable; without a slug it can't sync
      // attachments or metadata, so tell the user something's off.
      toast({
        title: "Workflow created locally but couldn't sync",
        description: "Check your connection — changes to it won't reach agents until it syncs.",
      });
    });
}

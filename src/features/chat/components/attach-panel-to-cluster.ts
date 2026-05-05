"use client";

/**
 * Append a freshly-created canvas panel to a cluster server-side by
 * doing a read-modify-write on /api/canvas/state.
 *
 * Used by the private chat: when a conversation is scoped to a cluster
 * and the user promotes an artifact to canvas, the artifact panel
 * should land inside that cluster automatically rather than the user
 * having to drag it in by hand on the canvas page.
 *
 * Cluster identity: `clusters[].dbId` mirrors `clusters.id` in the
 * Postgres `clusters` table. The chat's scope picker carries DB ids,
 * so we match against `dbId` here. Returns `true` on success, `false`
 * if the cluster isn't represented in `canvas_state.clusters` yet
 * (rare — clusters created on the canvas are always synced first) or
 * the request fails. Failure is non-fatal; the panel still exists on
 * the canvas, just outside any cluster.
 *
 * Concurrency: PATCH ships the row's `version` so a parallel canvas
 * tab can't silently lose this write. On 409 STALE_VERSION we re-fetch
 * once and retry — beyond that we give up rather than busy-loop a
 * fast-moving canvas.
 */

interface ClusterShape {
  id: string;
  dbId?: string;
  panelIds: string[];
  [key: string]: unknown;
}

interface CanvasStateShape {
  version: number;
  clusters?: ClusterShape[];
  [key: string]: unknown;
}

const MAX_RETRIES = 1;

export async function attachPanelToCluster({
  workspaceId,
  clusterDbId,
  panelId,
}: {
  workspaceId: string;
  clusterDbId: string;
  panelId: string;
}): Promise<boolean> {
  return attempt({ workspaceId, clusterDbId, panelId, retriesLeft: MAX_RETRIES });
}

async function attempt({
  workspaceId,
  clusterDbId,
  panelId,
  retriesLeft,
}: {
  workspaceId: string;
  clusterDbId: string;
  panelId: string;
  retriesLeft: number;
}): Promise<boolean> {
  const stateRes = await fetch("/api/canvas/state", {
    headers: { "X-Workspace-Id": workspaceId },
  });
  if (!stateRes.ok) return false;
  const stateJson = (await stateRes.json()) as {
    canvas_state?: CanvasStateShape;
  };
  const canvasState = stateJson.canvas_state;
  if (!canvasState) return false;

  const clusters: ClusterShape[] = Array.isArray(canvasState.clusters)
    ? canvasState.clusters
    : [];
  const target = clusters.find((c) => c.dbId === clusterDbId);
  if (!target) return false;
  if (target.panelIds.includes(panelId)) return true;

  // One-cluster-per-panel: strip the panel id from any other cluster
  // before appending to the target. Mirrors reducer ADD_PANEL_TO_CLUSTER.
  const updatedClusters = clusters.map((c) => {
    if (c === target) {
      return { ...c, panelIds: [...c.panelIds, panelId] };
    }
    if (c.panelIds.includes(panelId)) {
      return { ...c, panelIds: c.panelIds.filter((id) => id !== panelId) };
    }
    return c;
  });

  const patchRes = await fetch("/api/canvas/state", {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
      "X-Workspace-Id": workspaceId,
    },
    body: JSON.stringify({
      clusters: updatedClusters,
      if_version: canvasState.version,
    }),
  });

  if (patchRes.status === 409 && retriesLeft > 0) {
    return attempt({
      workspaceId,
      clusterDbId,
      panelId,
      retriesLeft: retriesLeft - 1,
    });
  }
  return patchRes.ok;
}

import "server-only";
import { supabaseAdmin } from "@/shared/supabase/admin";

/**
 * Side-effect helpers that mutate canvas-scoped tables (`canvas_panels`,
 * `canvas_state`) when a cluster is created or deleted. Lifted out of
 * `service.ts` to keep that file under the 500-line cap and to keep the
 * cluster CRUD readable. All functions are non-fatal: if they fail the
 * cluster row is still consistent — only the canvas visualization may be
 * off until the next reload reconciles it.
 */

export interface ClusterRef {
  id: string;
  slug: string;
  name: string;
}

interface WorkspaceScope {
  workspaceId: string;
  userId: string;
}

const BRAIN_PANEL_PLACEHOLDER =
  "_Brain not synthesized yet._\n\nAsk your connected Claude Code (or any Dopl-MCP-enabled agent) to call `get_skill_template` and run synthesis against this cluster's entries, then `update_cluster_brain` to save the result. Server-side auto-synthesis has been removed so you control exactly what lands in your skill.";

/**
 * Spawn the cluster-brain canvas panel + hydrate the visual cluster
 * grouping in `canvas_state.clusters`. Both writes are non-fatal: the
 * cluster is fully usable via MCP even if these fail; only the on-canvas
 * box around member entries depends on them.
 */
export async function spawnClusterBrainPanel(
  scope: WorkspaceScope,
  cluster: ClusterRef,
  safeEntryIds: string[]
): Promise<void> {
  if (safeEntryIds.length === 0) return;
  const db = supabaseAdmin();

  // Position: top-aligned with member entries, immediately to the right.
  const { data: entryPanels } = await db
    .from("canvas_panels")
    .select("x, y, width")
    .eq("workspace_id", scope.workspaceId)
    .eq("panel_type", "entry")
    .in("entry_id", safeEntryIds);

  let brainX = 0;
  let brainY = 0;
  if (entryPanels && entryPanels.length > 0) {
    const panels = entryPanels as { x: number; y: number; width: number }[];
    brainX = Math.max(...panels.map((p) => p.x + (p.width ?? 380))) + 40;
    brainY = Math.min(...panels.map((p) => p.y));
  }

  const brainPanelId = `brain-${cluster.id}`;
  const { error: brainPanelError } = await db.from("canvas_panels").insert({
    user_id: scope.userId,
    workspace_id: scope.workspaceId,
    panel_id: brainPanelId,
    panel_type: "cluster-brain",
    x: brainX,
    y: brainY,
    width: 480,
    height: 400,
    panel_data: {
      clusterId: cluster.id,
      clusterName: cluster.name,
      instructions: BRAIN_PANEL_PLACEHOLDER,
      memories: [],
      status: "ready",
      errorMessage: null,
    },
  });
  if (brainPanelError) {
    console.error(
      `[clusters] Failed to spawn brain panel for cluster ${cluster.slug}:`,
      brainPanelError.message
    );
    return;
  }

  // Hydrate canvas_state.clusters[] — drives the visual grouping box.
  const { data: entryPanelRows } = await db
    .from("canvas_panels")
    .select("panel_id, entry_id")
    .eq("workspace_id", scope.workspaceId)
    .eq("panel_type", "entry")
    .in("entry_id", safeEntryIds);

  const entryPanelIds = (entryPanelRows ?? []).map(
    (r) => (r as { panel_id: string }).panel_id
  );
  const memberPanelIds = [...entryPanelIds, brainPanelId];

  const { data: stateRow } = await db
    .from("canvas_state")
    .select("clusters")
    .eq("workspace_id", scope.workspaceId)
    .maybeSingle();

  const existingClusters = Array.isArray(stateRow?.clusters)
    ? ((stateRow as { clusters: unknown[] }).clusters as Record<string, unknown>[])
    : [];

  const newClusterEntry = {
    // `cluster-` prefix matches the client's string-id convention.
    id: `cluster-${cluster.id}`,
    name: cluster.name,
    panelIds: memberPanelIds,
    createdAt: new Date().toISOString(),
    dbId: cluster.id,
    slug: cluster.slug,
  };

  const { error: stateError } = await db
    .from("canvas_state")
    .upsert(
      {
        user_id: scope.userId,
        workspace_id: scope.workspaceId,
        clusters: [...existingClusters, newClusterEntry],
        updated_at: new Date().toISOString(),
      },
      { onConflict: "workspace_id" }
    );

  if (stateError) {
    console.error(
      `[clusters] Failed to hydrate canvas_state.clusters for cluster ${cluster.slug}:`,
      stateError.message
    );
  }
}

/**
 * Remove the cluster-brain canvas panel and prune the visual grouping
 * from `canvas_state.clusters`. Idempotent — safe to call when the
 * panel/state entry never existed.
 */
export async function tearDownClusterCanvasArtifacts(
  scope: WorkspaceScope,
  cluster: { id: string } | null,
  slug: string
): Promise<void> {
  const db = supabaseAdmin();

  if (cluster) {
    const { error: brainPanelError } = await db
      .from("canvas_panels")
      .delete()
      .eq("workspace_id", scope.workspaceId)
      .eq("panel_type", "cluster-brain")
      .eq("panel_id", `brain-${cluster.id}`);
    if (brainPanelError) {
      console.error(
        `[clusters] Failed to delete brain panel for cluster ${slug}:`,
        brainPanelError.message
      );
    }
  }

  const { data: stateRow } = await db
    .from("canvas_state")
    .select("clusters")
    .eq("workspace_id", scope.workspaceId)
    .maybeSingle();

  if (!stateRow || !Array.isArray((stateRow as { clusters: unknown[] }).clusters)) {
    return;
  }

  const existing = (stateRow as { clusters: Record<string, unknown>[] }).clusters;
  const pruned = existing.filter((c) => {
    const entrySlug = typeof c.slug === "string" ? c.slug : null;
    const entryDbId = typeof c.dbId === "string" ? c.dbId : null;
    if (entrySlug === slug) return false;
    if (cluster && entryDbId === cluster.id) return false;
    return true;
  });
  if (pruned.length === existing.length) return;

  const { error: stateError } = await db
    .from("canvas_state")
    .upsert(
      {
        user_id: scope.userId,
        workspace_id: scope.workspaceId,
        clusters: pruned,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "workspace_id" }
    );
  if (stateError) {
    console.error(
      `[clusters] Failed to prune canvas_state.clusters for cluster ${slug}:`,
      stateError.message
    );
  }
}

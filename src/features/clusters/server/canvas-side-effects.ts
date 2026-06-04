import "server-only";
import { supabaseAdmin } from "@/shared/supabase/admin";

/**
 * Side-effect helpers that mutate canvas-scoped tables (`canvas_panels`,
 * `canvas_state`) when a cluster is created or deleted. Lifted out of
 * `service.ts` to keep that file under the 500-line cap and to keep the
 * cluster CRUD readable.
 *
 * Create-side (`hydrateClusterGrouping`) is non-fatal: a freshly created
 * cluster still works via MCP without the on-canvas grouping box; a
 * partial canvas is acceptable.
 *
 * Delete-side (`tearDownClusterCanvasArtifacts`) THROWS on failure so
 * the cluster row delete is held back and the user can retry. If we
 * swallowed errors here, the cluster row would vanish while
 * `canvas_state.clusters[]` kept a dangling entry pointing at it,
 * surfacing as a broken card on the canvas. The write inside it is
 * idempotent (UPSERT-with-pruned-array) so retry is safe.
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

/**
 * Hydrate the visual cluster grouping in `canvas_state.clusters[]` so the
 * canvas draws a box around the cluster's member entry panels. Non-fatal:
 * the cluster is fully usable via MCP even if this fails; only the
 * on-canvas box depends on it.
 */
export async function hydrateClusterGrouping(
  scope: WorkspaceScope,
  cluster: ClusterRef,
  safeEntryIds: string[]
): Promise<void> {
  if (safeEntryIds.length === 0) return;
  const db = supabaseAdmin();

  const { data: entryPanelRows } = await db
    .from("canvas_panels")
    .select("panel_id, entry_id")
    .eq("workspace_id", scope.workspaceId)
    .eq("panel_type", "entry")
    .in("entry_id", safeEntryIds);

  const memberPanelIds = (entryPanelRows ?? []).map(
    (r) => (r as { panel_id: string }).panel_id
  );

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
 * Prune the visual cluster grouping from `canvas_state.clusters`.
 * Idempotent — safe to call when the state entry never existed.
 */
export async function tearDownClusterCanvasArtifacts(
  scope: WorkspaceScope,
  cluster: { id: string } | null,
  slug: string
): Promise<void> {
  const db = supabaseAdmin();

  const { data: stateRow, error: readError } = await db
    .from("canvas_state")
    .select("clusters")
    .eq("workspace_id", scope.workspaceId)
    .maybeSingle();
  if (readError) {
    throw new Error(
      `Failed to read canvas_state for cluster teardown ${slug}: ${readError.message}`
    );
  }

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
    throw new Error(
      `Failed to prune canvas_state.clusters for cluster ${slug}: ${stateError.message}`
    );
  }
}

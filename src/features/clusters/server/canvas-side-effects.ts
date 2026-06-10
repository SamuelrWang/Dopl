import "server-only";
import { supabaseAdmin } from "@/shared/supabase/admin";

/**
 * Side-effect helpers that mutate `canvas_state` when a cluster is deleted.
 *
 * `tearDownClusterCanvasArtifacts` THROWS on failure so the cluster row
 * delete is held back and the user can retry. If we swallowed errors here,
 * the cluster row would vanish while `canvas_state.clusters[]` kept a
 * dangling entry pointing at it, surfacing as a broken card on the canvas.
 * The write inside it is idempotent (UPSERT-with-pruned-array) so retry is
 * safe.
 */

interface WorkspaceScope {
  workspaceId: string;
  userId: string;
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
  const removedEntries: Record<string, unknown>[] = [];
  const pruned = existing.filter((c) => {
    const entrySlug = typeof c.slug === "string" ? c.slug : null;
    const entryDbId = typeof c.dbId === "string" ? c.dbId : null;
    const matches =
      entrySlug === slug || (cluster != null && entryDbId === cluster.id);
    if (matches) removedEntries.push(c);
    return !matches;
  });
  if (pruned.length === existing.length) return;

  // Also remove the cluster's cluster-info panel row: without this, a
  // server-side delete (clusters page, MCP dopl_cluster_admin) leaves an
  // orphaned header card on the canvas pointing at a deleted cluster —
  // it renders "Cluster removed." with no close affordance (its
  // lifecycle is the cluster's, which no longer exists).
  const infoPanelIds = removedEntries
    .map((c) => (typeof c.infoPanelId === "string" ? c.infoPanelId : null))
    .filter((id): id is string => id !== null);
  if (infoPanelIds.length > 0) {
    const { error: panelError } = await db
      .from("canvas_panels")
      .delete()
      .eq("workspace_id", scope.workspaceId)
      .in("panel_id", infoPanelIds);
    if (panelError) {
      throw new Error(
        `Failed to remove cluster-info panel(s) for cluster ${slug}: ${panelError.message}`
      );
    }
  }

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

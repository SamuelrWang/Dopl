import "server-only";
import { supabaseAdmin } from "@/shared/supabase/admin";
import { slugifyClusterName } from "../slug";
import { normalizeClusterName } from "@/shared/lib/cluster-name";

// ── Types ────────────────────────────────────────────────────────────
//
// Clusters are non-spatial CONTAINERS that group workflows. KB/skill
// attachments + the node graph live at the workflow level (see
// features/workflows); a cluster only carries name/slug/description and
// the list of workflows assigned to it.

export interface ClusterWorkflowSummary {
  id: string;
  name: string;
  slug: string;
  description: string | null;
}

export interface ClusterRow {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  created_at: string;
  updated_at: string;
  /** Count of workflows assigned to this cluster. */
  workflow_count: number;
  /** Names of assigned workflows, for at-a-glance summaries. */
  workflow_names: string[];
}

export interface ClusterDetail extends ClusterRow {
  workflows: ClusterWorkflowSummary[];
}

export interface ClusterCreateRequest {
  name: string;
  description?: string | null;
}

export interface ClusterUpdateRequest {
  name?: string;
  description?: string | null;
}

export interface ClusterScope {
  workspaceId: string;
  userId: string;
  source: "user" | "agent";
}

const SELECT_COLS = "id, slug, name, description, created_at, updated_at";

// ── CRUD ─────────────────────────────────────────────────────────────

export async function listClusters(scope: ClusterScope): Promise<ClusterRow[]> {
  const db = supabaseAdmin();
  const { data, error } = await db
    .from("clusters")
    .select(SELECT_COLS)
    .eq("workspace_id", scope.workspaceId)
    .order("created_at", { ascending: false });
  if (error) throw error;

  const rows = data || [];
  if (rows.length === 0) return [];
  const ids = rows.map((r) => r.id);

  const { data: wfRows, error: wfErr } = await db
    .from("workflows")
    .select("name, cluster_id")
    .in("cluster_id", ids)
    .eq("workspace_id", scope.workspaceId);
  if (wfErr) throw wfErr;

  const namesByCluster = new Map<string, string[]>();
  for (const w of wfRows || []) {
    if (!w.cluster_id) continue;
    const arr = namesByCluster.get(w.cluster_id) || [];
    arr.push(w.name);
    namesByCluster.set(w.cluster_id, arr);
  }

  return rows.map((r) => {
    const workflow_names = namesByCluster.get(r.id) || [];
    return { ...r, workflow_count: workflow_names.length, workflow_names };
  });
}

export async function getCluster(
  slug: string,
  scope: ClusterScope
): Promise<ClusterDetail> {
  const db = supabaseAdmin();
  const { data: cluster, error } = await db
    .from("clusters")
    .select(SELECT_COLS)
    .eq("slug", slug)
    .eq("workspace_id", scope.workspaceId)
    .single();
  if (error || !cluster) throw new Error(`Cluster not found: ${slug}`);

  const { data: workflows, error: wfErr } = await db
    .from("workflows")
    .select("id, name, slug, description")
    .eq("cluster_id", cluster.id)
    .eq("workspace_id", scope.workspaceId)
    .order("created_at", { ascending: true });
  if (wfErr) throw wfErr;

  const list = workflows || [];
  return {
    ...cluster,
    workflow_count: list.length,
    workflow_names: list.map((w) => w.name),
    workflows: list,
  };
}

export async function createCluster(
  req: ClusterCreateRequest,
  scope: ClusterScope
): Promise<ClusterRow> {
  const db = supabaseAdmin();

  const { count: priorCount } = await db
    .from("clusters")
    .select("id", { count: "exact", head: true })
    .eq("user_id", scope.userId);
  const isFirstCluster = (priorCount ?? 0) === 0;

  const name = normalizeClusterName(req.name);

  const { data: existing } = await db
    .from("clusters")
    .select("slug")
    .eq("workspace_id", scope.workspaceId);
  const existingSlugs = (existing || []).map((r) => r.slug);
  const slug = slugifyClusterName(name, existingSlugs);

  const { data: cluster, error: insError } = await db
    .from("clusters")
    .insert({
      workspace_id: scope.workspaceId,
      user_id: scope.userId,
      name,
      slug,
      description: req.description ?? null,
    })
    .select(SELECT_COLS)
    .single();
  if (insError) throw insError;
  if (!cluster) throw new Error("Failed to create cluster");

  if (isFirstCluster) {
    import("@/features/analytics/server/conversion-events")
      .then(({ logConversionEvent }) =>
        logConversionEvent({
          userId: scope.userId,
          eventType: "first_cluster_built",
          metadata: { cluster_id: cluster.id, slug: cluster.slug },
        })
      )
      .catch(() => {});
  }

  return { ...cluster, workflow_count: 0, workflow_names: [] };
}

export async function updateCluster(
  slug: string,
  req: ClusterUpdateRequest,
  scope: ClusterScope
): Promise<ClusterRow> {
  const db = supabaseAdmin();

  const { data: cluster, error: lookupError } = await db
    .from("clusters")
    .select(SELECT_COLS)
    .eq("slug", slug)
    .eq("workspace_id", scope.workspaceId)
    .single();
  if (lookupError || !cluster) throw new Error(`Cluster not found: ${slug}`);

  const update: Record<string, unknown> = {};
  const nextName = req.name ? normalizeClusterName(req.name) : undefined;
  if (nextName && nextName !== cluster.name) {
    const { data: existing } = await db
      .from("clusters")
      .select("slug")
      .eq("workspace_id", scope.workspaceId);
    const existingSlugs = (existing || [])
      .map((r) => r.slug)
      .filter((s) => s !== cluster.slug);
    update.name = nextName;
    update.slug = slugifyClusterName(nextName, existingSlugs);
  }
  if (req.description !== undefined) update.description = req.description;

  if (Object.keys(update).length > 0) {
    update.updated_at = new Date().toISOString();
    const { error: updateError } = await db
      .from("clusters")
      .update(update)
      .eq("id", cluster.id)
      .eq("workspace_id", scope.workspaceId);
    if (updateError) throw updateError;
  }

  const { data: updated, error: refetchError } = await db
    .from("clusters")
    .select(SELECT_COLS)
    .eq("id", cluster.id)
    .single();
  if (refetchError || !updated) throw refetchError || new Error("Refetch failed");

  return { ...updated, workflow_count: 0, workflow_names: [] };
}

export async function deleteCluster(
  slug: string,
  scope: ClusterScope
): Promise<void> {
  const db = supabaseAdmin();
  // Deleting a container only removes the cluster row; its workflows
  // survive with cluster_id set null (FK ON DELETE SET NULL).
  const { error } = await db
    .from("clusters")
    .delete()
    .eq("slug", slug)
    .eq("workspace_id", scope.workspaceId);
  if (error) throw error;
}

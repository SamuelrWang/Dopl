import "server-only";
import { supabaseAdmin } from "@/shared/supabase/admin";
import { slugifyClusterName } from "../slug";
import { CONTEXT_CHAR_BUDGET_PER_FIELD } from "@/config";
import {
  spawnClusterBrainPanel,
  tearDownClusterCanvasArtifacts,
} from "./canvas-side-effects";

// ── Types ────────────────────────────────────────────────────────────

export interface ClusterRow {
  id: string;
  slug: string;
  name: string;
  created_at: string;
  updated_at: string;
  panel_count: number;
}

export interface ClusterDetailEntry {
  entry_id: string;
  slug: string | null;
  title: string | null;
  summary: string | null;
  readme: string | null;
  agents_md: string | null;
}

export interface ClusterDetail extends ClusterRow {
  entries: ClusterDetailEntry[];
}

export interface ClusterCreateRequest {
  name: string;
  entry_ids: string[];
}

export interface ClusterUpdateRequest {
  name?: string;
  entry_ids?: string[];
}

/**
 * Scope identifying the active workspace + the calling user. `canvasId`
 * is the new scope key; `userId` is retained for entry-access checks
 * (which are user-level) and for the legacy `user_id` column on cluster
 * rows used for attribution and analytics.
 */
export interface ClusterScope {
  canvasId: string;
  userId: string;
}

// ── CRUD ─────────────────────────────────────────────────────────────
//
// All cluster CRUD scopes by `canvasId`. Members of the canvas can read
// and (subject to role checks at the route layer) write. `userId` is
// passed through for entry-access filtering — entry visibility is a
// user-level concern, not a workspace one.

/**
 * Filter a list of entry IDs down to those the given user is allowed to
 * place in a cluster — either entries they ingested themselves, or
 * approved (public-visible) entries. Prevents an IDOR where someone
 * adds a stranger's pending/denied entry to their cluster.
 */
async function filterEntryIdsAccessible(
  entryIds: string[],
  userId: string
): Promise<string[]> {
  if (entryIds.length === 0) return [];
  const db = supabaseAdmin();
  const { data, error } = await db
    .from("entries")
    .select("id, ingested_by, moderation_status")
    .in("id", entryIds);
  if (error) throw error;
  const allowed = new Set<string>();
  for (const row of data || []) {
    if (row.moderation_status === "approved") allowed.add(row.id);
    else if (row.ingested_by === userId) allowed.add(row.id);
  }
  return entryIds.filter((id) => allowed.has(id));
}

export async function listClusters(scope: ClusterScope): Promise<ClusterRow[]> {
  const db = supabaseAdmin();
  const { data, error } = await db
    .from("clusters")
    .select("id, slug, name, created_at, updated_at")
    .eq("canvas_id", scope.canvasId)
    .order("created_at", { ascending: false });

  if (error) throw error;

  const rows = data || [];
  if (rows.length === 0) return [];

  const { data: counts, error: countError } = await db
    .from("cluster_panels")
    .select("cluster_id")
    .in(
      "cluster_id",
      rows.map((r) => r.id)
    );

  if (countError) throw countError;

  const countMap = new Map<string, number>();
  for (const row of counts || []) {
    countMap.set(row.cluster_id, (countMap.get(row.cluster_id) || 0) + 1);
  }

  return rows.map((r) => ({
    ...r,
    panel_count: countMap.get(r.id) || 0,
  }));
}

export async function getCluster(
  slug: string,
  scope: ClusterScope
): Promise<ClusterDetail> {
  const db = supabaseAdmin();
  const { data: cluster, error } = await db
    .from("clusters")
    .select("id, slug, name, created_at, updated_at")
    .eq("slug", slug)
    .eq("canvas_id", scope.canvasId)
    .single();

  if (error || !cluster) {
    throw new Error(`Cluster not found: ${slug}`);
  }

  const { data: panels, error: panelError } = await db
    .from("cluster_panels")
    .select("entry_id")
    .eq("cluster_id", cluster.id);

  if (panelError) throw panelError;

  const entryIds = (panels || []).map((p) => p.entry_id);
  let entries: ClusterDetailEntry[] = [];

  if (entryIds.length > 0) {
    const { data: entryRows, error: entryError } = await db
      .from("entries")
      .select("id, slug, title, summary, readme, agents_md")
      .in("id", entryIds);

    if (entryError) throw entryError;

    entries = (entryRows || []).map((e) => ({
      entry_id: e.id,
      slug: e.slug ?? null,
      title: e.title,
      summary: e.summary,
      readme: e.readme
        ? e.readme.slice(0, CONTEXT_CHAR_BUDGET_PER_FIELD)
        : null,
      agents_md: e.agents_md
        ? e.agents_md.slice(0, CONTEXT_CHAR_BUDGET_PER_FIELD)
        : null,
    }));
  }

  return {
    ...cluster,
    panel_count: entryIds.length,
    entries,
  };
}

export async function createCluster(
  req: ClusterCreateRequest,
  scope: ClusterScope
): Promise<ClusterRow> {
  const db = supabaseAdmin();

  // First-cluster signal for the conversion event. Counted at the user
  // level (a user's first cluster, regardless of canvas) — matches the
  // pre-overhaul semantics so analytics dashboards stay continuous.
  const { count: priorCount } = await db
    .from("clusters")
    .select("id", { count: "exact", head: true })
    .eq("user_id", scope.userId);
  const isFirstCluster = (priorCount ?? 0) === 0;

  // Generate unique slug scoped to this canvas's existing clusters.
  const { data: existing } = await db
    .from("clusters")
    .select("slug")
    .eq("canvas_id", scope.canvasId);
  const existingSlugs = (existing || []).map((r) => r.slug);
  const slug = slugifyClusterName(req.name, existingSlugs);

  // Strip out any entry_ids the user doesn't have access to (someone
  // else's pending/denied entry, etc). Silent filter — don't reveal
  // which ids were rejected.
  const safeEntryIds = await filterEntryIdsAccessible(
    req.entry_ids,
    scope.userId
  );

  // Atomic cluster + cluster_panels insert via RPC. Either both rows
  // land or neither does — no more orphan cluster rows on partial
  // failure. The brain-panel + canvas_state hydration that follows
  // stays in TS because they're already non-fatal (failure logs but
  // doesn't reject the user's request) and tolerate partial success.
  const { data: rpcRows, error: rpcError } = await db.rpc(
    "create_cluster_with_entries",
    {
      p_canvas_id: scope.canvasId,
      p_user_id: scope.userId,
      p_name: req.name,
      p_slug: slug,
      p_entry_ids: safeEntryIds,
    }
  );
  if (rpcError) throw rpcError;
  const cluster = Array.isArray(rpcRows) ? rpcRows[0] : rpcRows;
  if (!cluster) throw new Error("Failed to create cluster");

  await spawnClusterBrainPanel(scope, cluster, safeEntryIds);

  // Fire first_cluster_built event (analytics). Fire-and-forget; dynamic
  // import so this module stays import-free of the analytics tree in
  // environments that don't need it.
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

  return { ...cluster, panel_count: safeEntryIds.length };
}

export async function updateCluster(
  slug: string,
  req: ClusterUpdateRequest,
  scope: ClusterScope
): Promise<ClusterRow> {
  const db = supabaseAdmin();

  const { data: cluster, error: lookupError } = await db
    .from("clusters")
    .select("id, slug, name, created_at, updated_at")
    .eq("slug", slug)
    .eq("canvas_id", scope.canvasId)
    .single();

  if (lookupError || !cluster) {
    throw new Error(`Cluster not found: ${slug}`);
  }

  let newSlug = cluster.slug;

  if (req.name && req.name !== cluster.name) {
    const { data: existing } = await db
      .from("clusters")
      .select("slug")
      .eq("canvas_id", scope.canvasId);
    const existingSlugs = (existing || [])
      .map((r) => r.slug)
      .filter((s) => s !== cluster.slug);
    newSlug = slugifyClusterName(req.name, existingSlugs);

    const { error: updateError } = await db
      .from("clusters")
      .update({
        name: req.name,
        slug: newSlug,
        updated_at: new Date().toISOString(),
      })
      .eq("id", cluster.id)
      .eq("canvas_id", scope.canvasId);
    if (updateError) throw updateError;
  }

  let safeEntryIds: string[] | undefined;
  if (req.entry_ids) {
    safeEntryIds = await filterEntryIdsAccessible(req.entry_ids, scope.userId);

    const { error: delError } = await db
      .from("cluster_panels")
      .delete()
      .eq("cluster_id", cluster.id);
    if (delError) throw delError;

    if (safeEntryIds.length > 0) {
      const rows = safeEntryIds.map((eid) => ({
        cluster_id: cluster.id,
        entry_id: eid,
      }));
      const { error: insError } = await db
        .from("cluster_panels")
        .insert(rows);
      if (insError) throw insError;
    }
  }

  const { data: updated, error: refetchError } = await db
    .from("clusters")
    .select("id, slug, name, created_at, updated_at")
    .eq("id", cluster.id)
    .single();

  if (refetchError || !updated) throw refetchError || new Error("Refetch failed");

  const panelCount = safeEntryIds?.length ?? 0;
  return { ...updated, panel_count: panelCount };
}

export async function deleteCluster(
  slug: string,
  scope: ClusterScope
): Promise<void> {
  const db = supabaseAdmin();

  // Look up first so we know the id for cascade cleanup. Missing is OK
  // — delete is idempotent and we still want to clear orphaned canvas
  // rows from any prior broken state.
  const { data: cluster } = await db
    .from("clusters")
    .select("id")
    .eq("slug", slug)
    .eq("canvas_id", scope.canvasId)
    .maybeSingle();

  await tearDownClusterCanvasArtifacts(scope, cluster, slug);

  const { error } = await db
    .from("clusters")
    .delete()
    .eq("slug", slug)
    .eq("canvas_id", scope.canvasId);

  if (error) throw error;
}

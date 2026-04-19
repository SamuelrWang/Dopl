import { supabaseAdmin } from "@/lib/supabase";
import { slugifyClusterName } from "./slug";
import { CONTEXT_CHAR_BUDGET_PER_FIELD } from "@/lib/config";

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

// ── CRUD ─────────────────────────────────────────────────────────────
//
// IMPORTANT: `userId` is REQUIRED on all cluster CRUD. Clusters are
// per-user — callers must scope by the authenticated user. Never drop
// this check, even for "public" viewing (there are no public clusters).

/**
 * Filter a list of entry IDs down to those the given user is allowed to
 * place in a cluster — either entries they ingested themselves, or
 * approved (public-visible) entries. This prevents an IDOR where a user
 * adds a stranger's pending/denied entry to their cluster and then reads
 * the contents via the cluster query endpoint.
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

export async function listClusters(opts: { userId: string }): Promise<ClusterRow[]> {
  const db = supabaseAdmin();
  const { data, error } = await db
    .from("clusters")
    .select("id, slug, name, created_at, updated_at")
    .eq("user_id", opts.userId)
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
  opts: { userId: string }
): Promise<ClusterDetail> {
  const db = supabaseAdmin();
  const { data: cluster, error } = await db
    .from("clusters")
    .select("id, slug, name, created_at, updated_at")
    .eq("slug", slug)
    .eq("user_id", opts.userId)
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
  opts: { userId: string }
): Promise<ClusterRow> {
  const db = supabaseAdmin();

  // Pre-check whether this will be the user's first cluster (for the
  // first_cluster_built conversion event). Cheap indexed count.
  const { count: priorCount } = await db
    .from("clusters")
    .select("id", { count: "exact", head: true })
    .eq("user_id", opts.userId);
  const isFirstCluster = (priorCount ?? 0) === 0;

  // Generate unique slug scoped to this user's existing clusters.
  const { data: existing } = await db
    .from("clusters")
    .select("slug")
    .eq("user_id", opts.userId);
  const existingSlugs = (existing || []).map((r) => r.slug);
  const slug = slugifyClusterName(req.name, existingSlugs);

  const { data: cluster, error } = await db
    .from("clusters")
    .insert({ name: req.name, slug, user_id: opts.userId })
    .select("id, slug, name, created_at, updated_at")
    .single();

  if (error || !cluster) throw error || new Error("Failed to create cluster");

  // Strip out any entry_ids the user doesn't have access to (someone
  // else's pending/denied entry, etc). Silent filter — don't reveal
  // which ids were rejected.
  const safeEntryIds = await filterEntryIdsAccessible(
    req.entry_ids,
    opts.userId
  );

  if (safeEntryIds.length > 0) {
    const rows = safeEntryIds.map((eid) => ({
      cluster_id: cluster.id,
      entry_id: eid,
    }));
    const { error: panelError } = await db
      .from("cluster_panels")
      .insert(rows);
    if (panelError) throw panelError;
  }

  // ── Spawn a cluster-brain canvas panel ────────────────────────────
  // The UI's selection-menu path (create cluster by selecting entries
  // on the canvas) dispatches CREATE_CLUSTER_BRAIN_PANEL to Redux and
  // syncs to the DB via the canvas panel-save cycle. The MCP path
  // (`canvas_create_cluster` tool) hits this service directly without
  // going through the client, so without this block the cluster would
  // exist in the DB but have NO canvas panel — the user reloads and
  // sees no cluster box. Creating the brain panel here makes both
  // entry points behave identically.
  //
  // Positioning: if any of the member entries are already on the
  // canvas, place the brain panel to the right of the rightmost entry
  // at the topmost entry's y — matching the selection-menu's layout.
  // Otherwise default to origin so the user can drag it later.
  if (safeEntryIds.length > 0) {
    const { data: entryPanels } = await db
      .from("canvas_panels")
      .select("x, y, width")
      .eq("user_id", opts.userId)
      .eq("panel_type", "entry")
      .in("entry_id", safeEntryIds);

    let brainX = 0;
    let brainY = 0;
    if (entryPanels && entryPanels.length > 0) {
      const panels = entryPanels as { x: number; y: number; width: number }[];
      const rightmostX = Math.max(...panels.map((p) => p.x + (p.width ?? 380)));
      const topY = Math.min(...panels.map((p) => p.y));
      brainX = rightmostX + 40;
      brainY = topY;
    }

    const brainPanelId = `brain-${cluster.id}`;
    const { error: brainPanelError } = await db
      .from("canvas_panels")
      .insert({
        user_id: opts.userId,
        panel_id: brainPanelId,
        panel_type: "cluster-brain",
        x: brainX,
        y: brainY,
        width: 480,
        height: 400,
        panel_data: {
          clusterId: cluster.id,
          clusterName: cluster.name,
          instructions:
            "_Brain not synthesized yet._\n\nAsk your connected Claude Code (or any Dopl-MCP-enabled agent) to call `get_skill_template` and run synthesis against this cluster's entries, then `update_cluster_brain` to save the result. Server-side auto-synthesis has been removed so you control exactly what lands in your skill.",
          memories: [],
          status: "ready",
          errorMessage: null,
        },
      });
    // Non-fatal: if the brain-panel insert fails, the cluster still
    // exists and is usable via MCP; the user just won't see the panel
    // on the canvas until they retry or add it manually. Logging the
    // error lets ops see this in the health dashboard.
    if (brainPanelError) {
      console.error(
        `[clusters] Failed to spawn brain panel for cluster ${cluster.slug}:`,
        brainPanelError.message
      );
    }

    // ── Hydrate canvas_state.clusters ────────────────────────────────
    // The visual grouping on the canvas — the box around member panels
    // plus the cluster name header — is driven by `canvas_state.clusters`
    // (a JSON array), NOT by the `clusters` table. The UI's selection-
    // menu path updates this via Redux + a debounced PATCH to
    // /api/canvas/state. MCP-initiated cluster creation bypasses the
    // client entirely, so without this block the grouping visual never
    // appears on reload — the cluster exists in the DB, has a brain
    // panel, but no box is drawn around the member entries.
    //
    // Panel IDs are the LOCAL panel_id strings on canvas_panels
    // (e.g. "panel-7", "brain-<uuid>"), NOT entry UUIDs. Lookup the
    // entries' panel_ids, add the brain panel's id, and persist.
    const { data: entryPanelRows } = await db
      .from("canvas_panels")
      .select("panel_id, entry_id")
      .eq("user_id", opts.userId)
      .eq("panel_type", "entry")
      .in("entry_id", safeEntryIds);

    const entryPanelIds = (entryPanelRows ?? []).map(
      (r) => (r as { panel_id: string }).panel_id
    );

    const memberPanelIds = [...entryPanelIds, brainPanelId];

    const { data: stateRow } = await db
      .from("canvas_state")
      .select("clusters")
      .eq("user_id", opts.userId)
      .maybeSingle();

    const existingClusters = Array.isArray(stateRow?.clusters)
      ? ((stateRow as { clusters: unknown[] }).clusters as Record<string, unknown>[])
      : [];

    const newClusterEntry = {
      // Prefix with `cluster-` to match the client's string-id convention
      // for MCP-created clusters. The client reducer treats id as an
      // opaque string; no parseInt assumptions.
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
          user_id: opts.userId,
          clusters: [...existingClusters, newClusterEntry],
          updated_at: new Date().toISOString(),
        },
        { onConflict: "user_id" }
      );

    // Non-fatal for the same reason as the brain-panel insert — the
    // cluster data is intact; only the visual grouping is missing.
    if (stateError) {
      console.error(
        `[clusters] Failed to hydrate canvas_state.clusters for cluster ${cluster.slug}:`,
        stateError.message
      );
    }
  }

  // Fire first_cluster_built event (analytics). Fire-and-forget; dynamic
  // import so this module stays import-free of the analytics tree in
  // environments that don't need it.
  if (isFirstCluster) {
    import("@/lib/analytics/conversion-events")
      .then(({ logConversionEvent }) =>
        logConversionEvent({
          userId: opts.userId,
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
  opts: { userId: string }
): Promise<ClusterRow> {
  const db = supabaseAdmin();

  // Look up cluster scoped to the owner — if not found, the caller either
  // doesn't own it or it doesn't exist. Either way, treat as not-found.
  const { data: cluster, error: lookupError } = await db
    .from("clusters")
    .select("id, slug, name, created_at, updated_at")
    .eq("slug", slug)
    .eq("user_id", opts.userId)
    .single();

  if (lookupError || !cluster) {
    throw new Error(`Cluster not found: ${slug}`);
  }

  let newSlug = cluster.slug;

  if (req.name && req.name !== cluster.name) {
    const { data: existing } = await db
      .from("clusters")
      .select("slug")
      .eq("user_id", opts.userId);
    const existingSlugs = (existing || [])
      .map((r) => r.slug)
      .filter((s) => s !== cluster.slug);
    newSlug = slugifyClusterName(req.name, existingSlugs);

    const { error: updateError } = await db
      .from("clusters")
      .update({ name: req.name, slug: newSlug, updated_at: new Date().toISOString() })
      .eq("id", cluster.id)
      .eq("user_id", opts.userId);
    if (updateError) throw updateError;
  }

  let safeEntryIds: string[] | undefined;
  if (req.entry_ids) {
    safeEntryIds = await filterEntryIdsAccessible(req.entry_ids, opts.userId);

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
  opts: { userId: string }
): Promise<void> {
  const db = supabaseAdmin();
  const { error } = await db
    .from("clusters")
    .delete()
    .eq("slug", slug)
    .eq("user_id", opts.userId);

  if (error) throw error;
}

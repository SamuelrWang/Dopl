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

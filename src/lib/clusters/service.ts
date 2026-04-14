import { supabaseAdmin } from "@/lib/supabase";
import { slugifyClusterName } from "./slug";

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

import { CONTEXT_CHAR_BUDGET_PER_FIELD } from "@/lib/config";

export async function listClusters(opts?: { userId?: string }): Promise<ClusterRow[]> {
  const db = supabaseAdmin();
  let query = db
    .from("clusters")
    .select("id, slug, name, created_at, updated_at")
    .order("created_at", { ascending: false });

  if (opts?.userId) {
    query = query.eq("user_id", opts.userId);
  }

  const { data, error } = await query;

  if (error) throw error;

  // Count panels per cluster
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

export async function getCluster(slug: string): Promise<ClusterDetail> {
  const db = supabaseAdmin();
  const { data: cluster, error } = await db
    .from("clusters")
    .select("id, slug, name, created_at, updated_at")
    .eq("slug", slug)
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
      .select("id, title, summary, readme, agents_md")
      .in("id", entryIds);

    if (entryError) throw entryError;

    entries = (entryRows || []).map((e) => ({
      entry_id: e.id,
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
  opts?: { userId?: string }
): Promise<ClusterRow> {
  const db = supabaseAdmin();

  // Generate unique slug
  const { data: existing } = await db
    .from("clusters")
    .select("slug");
  const existingSlugs = (existing || []).map((r) => r.slug);
  const slug = slugifyClusterName(req.name, existingSlugs);

  const insertRow: Record<string, unknown> = { name: req.name, slug };
  if (opts?.userId) insertRow.user_id = opts.userId;

  const { data: cluster, error } = await db
    .from("clusters")
    .insert(insertRow)
    .select("id, slug, name, created_at, updated_at")
    .single();

  if (error || !cluster) throw error || new Error("Failed to create cluster");

  // Insert panel memberships
  if (req.entry_ids.length > 0) {
    const rows = req.entry_ids.map((eid) => ({
      cluster_id: cluster.id,
      entry_id: eid,
    }));
    const { error: panelError } = await db
      .from("cluster_panels")
      .insert(rows);
    if (panelError) throw panelError;
  }

  return { ...cluster, panel_count: req.entry_ids.length };
}

export async function updateCluster(
  slug: string,
  req: ClusterUpdateRequest
): Promise<ClusterRow> {
  const db = supabaseAdmin();

  // Look up cluster
  const { data: cluster, error: lookupError } = await db
    .from("clusters")
    .select("id, slug, name, created_at, updated_at")
    .eq("slug", slug)
    .single();

  if (lookupError || !cluster) {
    throw new Error(`Cluster not found: ${slug}`);
  }

  let newSlug = cluster.slug;

  // Update name (and re-slug)
  if (req.name && req.name !== cluster.name) {
    const { data: existing } = await db
      .from("clusters")
      .select("slug");
    const existingSlugs = (existing || [])
      .map((r) => r.slug)
      .filter((s) => s !== cluster.slug);
    newSlug = slugifyClusterName(req.name, existingSlugs);

    const { error: updateError } = await db
      .from("clusters")
      .update({ name: req.name, slug: newSlug, updated_at: new Date().toISOString() })
      .eq("id", cluster.id);
    if (updateError) throw updateError;
  }

  // Replace entry memberships
  if (req.entry_ids) {
    // Delete existing
    const { error: delError } = await db
      .from("cluster_panels")
      .delete()
      .eq("cluster_id", cluster.id);
    if (delError) throw delError;

    // Insert new
    if (req.entry_ids.length > 0) {
      const rows = req.entry_ids.map((eid) => ({
        cluster_id: cluster.id,
        entry_id: eid,
      }));
      const { error: insError } = await db
        .from("cluster_panels")
        .insert(rows);
      if (insError) throw insError;
    }
  }

  // Return updated row
  const { data: updated, error: refetchError } = await db
    .from("clusters")
    .select("id, slug, name, created_at, updated_at")
    .eq("id", cluster.id)
    .single();

  if (refetchError || !updated) throw refetchError || new Error("Refetch failed");

  const panelCount = req.entry_ids?.length ?? 0;
  return { ...updated, panel_count: panelCount };
}

export async function deleteCluster(slug: string): Promise<void> {
  const db = supabaseAdmin();
  const { error } = await db
    .from("clusters")
    .delete()
    .eq("slug", slug);

  if (error) throw error;
}

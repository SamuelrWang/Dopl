import "server-only";
import { supabaseAdmin } from "@/shared/supabase/admin";
import { slugifyClusterName } from "../slug";
import { normalizeClusterName } from "@/shared/lib/cluster-name";
import { tearDownClusterCanvasArtifacts } from "./canvas-side-effects";
import {
  listAttachedKnowledgeBasesById,
  listAttachedSkillsById,
  type ClusterAttachedKnowledgeBase,
  type ClusterAttachedSkill,
} from "./attachments";

// ── Types ────────────────────────────────────────────────────────────

export interface ClusterRow {
  id: string;
  slug: string;
  name: string;
  created_at: string;
  updated_at: string;
  /** Deprecated — clusters no longer hold entry/setup panels. Always 0. */
  panel_count: number;
  /** Count of attached (non-deleted) knowledge bases. */
  knowledge_base_count: number;
  /** Count of attached (non-deleted) skills. */
  skill_count: number;
  /** Names of attached knowledge bases, for at-a-glance summaries. */
  knowledge_base_names: string[];
  /** Names of attached skills, for at-a-glance summaries. */
  skill_names: string[];
}

export interface ClusterDetail extends ClusterRow {
  knowledge_bases: ClusterAttachedKnowledgeBase[];
  skills: ClusterAttachedSkill[];
}

export interface ClusterCreateRequest {
  name: string;
}

export interface ClusterUpdateRequest {
  name?: string;
}

/**
 * Scope identifying the active workspace + the calling user. `workspaceId`
 * is the scope key; `userId` is retained for the `user_id` column on cluster
 * rows used for attribution and analytics. `source` distinguishes
 * agent-origin (API key auth) from user-origin (session auth) calls.
 */
export interface ClusterScope {
  workspaceId: string;
  userId: string;
  source: "user" | "agent";
}

// ── CRUD ─────────────────────────────────────────────────────────────
//
// All cluster CRUD scopes by `workspaceId`. Clusters are containers for
// attached knowledge bases + skills.

export async function listClusters(scope: ClusterScope): Promise<ClusterRow[]> {
  const db = supabaseAdmin();
  const { data, error } = await db
    .from("clusters")
    .select("id, slug, name, created_at, updated_at")
    .eq("workspace_id", scope.workspaceId)
    .order("created_at", { ascending: false });

  if (error) throw error;

  const rows = data || [];
  if (rows.length === 0) return [];
  const ids = rows.map((r) => r.id);

  // Attached KB + skill names, batched across all clusters so the list
  // stays a cheap metadata call. Manual two-step joins (not PostgREST
  // embedded resources) — see attachments.ts for why embedded joins are
  // avoided after the workspace_id denormalization.
  const [kbLinkRes, skillLinkRes] = await Promise.all([
    db
      .from("cluster_knowledge_bases")
      .select("cluster_id, knowledge_base_id")
      .in("cluster_id", ids)
      .eq("workspace_id", scope.workspaceId),
    db
      .from("cluster_skills")
      .select("cluster_id, skill_id")
      .in("cluster_id", ids)
      .eq("workspace_id", scope.workspaceId),
  ]);
  if (kbLinkRes.error) throw kbLinkRes.error;
  if (skillLinkRes.error) throw skillLinkRes.error;

  const kbIds = [
    ...new Set((kbLinkRes.data || []).map((r) => r.knowledge_base_id)),
  ];
  const skillIds = [
    ...new Set((skillLinkRes.data || []).map((r) => r.skill_id)),
  ];

  // Resolve names, dropping soft-deleted resources.
  const kbNameById = new Map<string, string>();
  if (kbIds.length > 0) {
    const { data: kbRows, error: kbErr } = await db
      .from("knowledge_bases")
      .select("id, name, deleted_at")
      .in("id", kbIds)
      .eq("workspace_id", scope.workspaceId);
    if (kbErr) throw kbErr;
    for (const k of kbRows || []) {
      if (k.deleted_at === null) kbNameById.set(k.id, k.name);
    }
  }
  const skillNameById = new Map<string, string>();
  if (skillIds.length > 0) {
    const { data: skillRows, error: skillErr } = await db
      .from("skills")
      .select("id, name, deleted_at")
      .in("id", skillIds)
      .eq("workspace_id", scope.workspaceId);
    if (skillErr) throw skillErr;
    for (const s of skillRows || []) {
      if (s.deleted_at === null) skillNameById.set(s.id, s.name);
    }
  }

  // Group resolved names per cluster (skipping deleted resources absent
  // from the name maps).
  const kbNamesByCluster = new Map<string, string[]>();
  for (const link of kbLinkRes.data || []) {
    const name = kbNameById.get(link.knowledge_base_id);
    if (!name) continue;
    const arr = kbNamesByCluster.get(link.cluster_id) || [];
    arr.push(name);
    kbNamesByCluster.set(link.cluster_id, arr);
  }
  const skillNamesByCluster = new Map<string, string[]>();
  for (const link of skillLinkRes.data || []) {
    const name = skillNameById.get(link.skill_id);
    if (!name) continue;
    const arr = skillNamesByCluster.get(link.cluster_id) || [];
    arr.push(name);
    skillNamesByCluster.set(link.cluster_id, arr);
  }

  return rows.map((r) => {
    const knowledge_base_names = kbNamesByCluster.get(r.id) || [];
    const skill_names = skillNamesByCluster.get(r.id) || [];
    return {
      ...r,
      panel_count: 0,
      knowledge_base_count: knowledge_base_names.length,
      skill_count: skill_names.length,
      knowledge_base_names,
      skill_names,
    };
  });
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
    .eq("workspace_id", scope.workspaceId)
    .single();

  if (error || !cluster) {
    throw new Error(`Cluster not found: ${slug}`);
  }

  const [knowledge_bases, skills] = await Promise.all([
    listAttachedKnowledgeBasesById(cluster.id, scope),
    listAttachedSkillsById(cluster.id, scope),
  ]);

  return {
    ...cluster,
    panel_count: 0,
    knowledge_base_count: knowledge_bases.length,
    skill_count: skills.length,
    knowledge_base_names: knowledge_bases.map((k) => k.name),
    skill_names: skills.map((s) => s.name),
    knowledge_bases,
    skills,
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

  // Canonicalize the name to UPPER_SNAKE so the stored name matches the
  // canvas display and the agent's listing. The slug stays lowercase-hyphen.
  const name = normalizeClusterName(req.name);

  // Generate unique slug scoped to this workspace's existing clusters.
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
    })
    .select("id, slug, name, created_at, updated_at")
    .single();
  if (insError) throw insError;
  if (!cluster) throw new Error("Failed to create cluster");

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

  return {
    ...cluster,
    panel_count: 0,
    knowledge_base_count: 0,
    skill_count: 0,
    knowledge_base_names: [],
    skill_names: [],
  };
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
    .eq("workspace_id", scope.workspaceId)
    .single();

  if (lookupError || !cluster) {
    throw new Error(`Cluster not found: ${slug}`);
  }

  let newSlug = cluster.slug;

  const nextName = req.name ? normalizeClusterName(req.name) : undefined;
  if (nextName && nextName !== cluster.name) {
    const { data: existing } = await db
      .from("clusters")
      .select("slug")
      .eq("workspace_id", scope.workspaceId);
    const existingSlugs = (existing || [])
      .map((r) => r.slug)
      .filter((s) => s !== cluster.slug);
    newSlug = slugifyClusterName(nextName, existingSlugs);

    const { error: updateError } = await db
      .from("clusters")
      .update({
        name: nextName,
        slug: newSlug,
        updated_at: new Date().toISOString(),
      })
      .eq("id", cluster.id)
      .eq("workspace_id", scope.workspaceId);
    if (updateError) throw updateError;
  }

  const { data: updated, error: refetchError } = await db
    .from("clusters")
    .select("id, slug, name, created_at, updated_at")
    .eq("id", cluster.id)
    .single();

  if (refetchError || !updated) throw refetchError || new Error("Refetch failed");

  return {
    ...updated,
    panel_count: 0,
    knowledge_base_count: 0,
    skill_count: 0,
    knowledge_base_names: [],
    skill_names: [],
  };
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
    .eq("workspace_id", scope.workspaceId)
    .maybeSingle();

  await tearDownClusterCanvasArtifacts(scope, cluster, slug);

  const { error } = await db
    .from("clusters")
    .delete()
    .eq("slug", slug)
    .eq("workspace_id", scope.workspaceId);

  if (error) throw error;
}

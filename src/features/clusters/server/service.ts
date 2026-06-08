import "server-only";
import { supabaseAdmin } from "@/shared/supabase/admin";
import { slugifyClusterName } from "../slug";
import { normalizeClusterName } from "@/shared/lib/cluster-name";
import { CONTEXT_CHAR_BUDGET_PER_FIELD } from "@/config";
import {
  hydrateClusterGrouping,
  tearDownClusterCanvasArtifacts,
} from "./canvas-side-effects";
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
  /** Count of entry/setup panels grouped in the cluster. */
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
  knowledge_bases: ClusterAttachedKnowledgeBase[];
  skills: ClusterAttachedSkill[];
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
 * Scope identifying the active workspace + the calling user. `workspaceId`
 * is the new scope key; `userId` is retained for entry-access checks
 * (which are user-level) and for the legacy `user_id` column on cluster
 * rows used for attribution and analytics. `source` distinguishes
 * agent-origin (API key auth) from user-origin (session auth) calls,
 * mirroring `KnowledgeContext.source`. Agent-origin attach/detach is
 * gated by the per-KB / per-skill `agent_write_enabled` toggle.
 */
export interface ClusterScope {
  workspaceId: string;
  userId: string;
  source: "user" | "agent";
}

// ── CRUD ─────────────────────────────────────────────────────────────
//
// All cluster CRUD scopes by `workspaceId`. Members of the canvas can read
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
    .eq("workspace_id", scope.workspaceId)
    .order("created_at", { ascending: false });

  if (error) throw error;

  const rows = data || [];
  if (rows.length === 0) return [];
  const ids = rows.map((r) => r.id);

  // Entry-panel counts.
  const { data: counts, error: countError } = await db
    .from("cluster_panels")
    .select("cluster_id")
    .in("cluster_id", ids);
  if (countError) throw countError;

  const countMap = new Map<string, number>();
  for (const row of counts || []) {
    countMap.set(row.cluster_id, (countMap.get(row.cluster_id) || 0) + 1);
  }

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
      panel_count: countMap.get(r.id) || 0,
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

  const [knowledge_bases, skills] = await Promise.all([
    listAttachedKnowledgeBasesById(cluster.id, scope),
    listAttachedSkillsById(cluster.id, scope),
  ]);

  return {
    ...cluster,
    panel_count: entryIds.length,
    knowledge_base_count: knowledge_bases.length,
    skill_count: skills.length,
    knowledge_base_names: knowledge_bases.map((k) => k.name),
    skill_names: skills.map((s) => s.name),
    entries,
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

  // Generate unique slug scoped to this canvas's existing clusters.
  const { data: existing } = await db
    .from("clusters")
    .select("slug")
    .eq("workspace_id", scope.workspaceId);
  const existingSlugs = (existing || []).map((r) => r.slug);
  const slug = slugifyClusterName(name, existingSlugs);

  // Strip out any entry_ids the user doesn't have access to (someone
  // else's pending/denied entry, etc). Silent filter — don't reveal
  // which ids were rejected.
  const safeEntryIds = await filterEntryIdsAccessible(
    req.entry_ids,
    scope.userId
  );

  // Atomic cluster + cluster_panels insert via RPC. Either both rows
  // land or neither does — no more orphan cluster rows on partial
  // failure. The canvas_state grouping hydration that follows stays in
  // TS because it's already non-fatal (failure logs but doesn't reject
  // the user's request) and tolerates partial success.
  const { data: rpcRows, error: rpcError } = await db.rpc(
    "create_cluster_with_entries",
    {
      p_workspace_id: scope.workspaceId,
      p_user_id: scope.userId,
      p_name: name,
      p_slug: slug,
      p_entry_ids: safeEntryIds,
    }
  );
  if (rpcError) throw rpcError;
  const cluster = Array.isArray(rpcRows) ? rpcRows[0] : rpcRows;
  if (!cluster) throw new Error("Failed to create cluster");

  await hydrateClusterGrouping(scope, cluster, safeEntryIds);

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

  // A new cluster has no attached KBs/skills yet (attachment is a separate
  // action), so the summary fields are empty here. Call getCluster for the
  // full picture.
  return {
    ...cluster,
    panel_count: safeEntryIds.length,
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
  // This return reflects entry membership only; KB/skill attachments are
  // unchanged by an update and not surfaced here. Call getCluster for them.
  return {
    ...updated,
    panel_count: panelCount,
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

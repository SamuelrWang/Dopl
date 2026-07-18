import "server-only";

import { mergeStoredLayout, type GraphLayout } from "@/shared/graph";
import { supabaseAdmin } from "@/shared/supabase/admin";
import { isUuid } from "@/shared/lib/id/uuid";
import { HttpError } from "@/shared/lib/http-error";
import type { Role } from "@/features/workspaces/types";
import {
  listEffectiveAccess,
  requireEffectiveAccess,
  resolveLevel,
} from "@/features/teams/server/access";
import { slugifyWorkflowName } from "../slug";
import { composeWorkflow, type WorkflowGraph } from "./graph";
import { countSteps } from "./repository";
import {
  listAttachedKnowledgeBasesById,
  listAttachedSkillsById,
  resolveWorkflowId,
  type WorkflowAttachedKnowledgeBase,
  type WorkflowAttachedSkill,
} from "./attachments";

// ── Types ────────────────────────────────────────────────────────────

export interface WorkflowRow {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  cluster_id: string | null;
  /** 'workspace' = every member; 'teams' = granted teams only. */
  access_mode: "workspace" | "teams";
  /** Creator (retains edit on teams-mode workflows). */
  user_id: string | null;
  /** Persisted dragged step positions (id → {x,y}); `{}` = pure auto-layout. */
  layout: GraphLayout;
  created_at: string;
  updated_at: string;
  step_count: number;
  knowledge_base_count: number;
  skill_count: number;
  knowledge_base_names: string[];
  skill_names: string[];
}

export interface WorkflowDetail extends WorkflowRow {
  knowledge_bases: WorkflowAttachedKnowledgeBase[];
  skills: WorkflowAttachedSkill[];
  /** Step graph composed from workflow_steps + workflow_step_edges. */
  graph: WorkflowGraph | null;
}

export interface WorkflowCreateRequest {
  /** Client-generated id so a UI can create the row + author it in one flow. */
  id?: string;
  name: string;
  description?: string | null;
  clusterId?: string | null;
}

export interface WorkflowUpdateRequest {
  name?: string;
  description?: string | null;
  clusterId?: string | null;
  /** Web-only: dragged step positions. Agents (MCP) never send this. */
  layout?: GraphLayout;
}

export interface WorkflowScope {
  workspaceId: string;
  userId: string;
  /** Caller's workspace role — used for team-access resolution without refetching membership. */
  role: Role;
  source: "user" | "agent";
}

const SELECT_COLS =
  "id, slug, name, description, cluster_id, access_mode, user_id, layout, created_at, updated_at";

/** A soft-deleted workflow, as surfaced in the trash view. */
export interface WorkflowTrashRow {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  deleted_at: string;
}

/**
 * Canonical stored form for a workflow's DISPLAY name: trim only. F-24 —
 * the display name used to be run through `normalizeClusterName`, which
 * uppercased it and collapsed whitespace to underscores (so a caller's
 * `swarm-wf-pipeline` was stored as `SWARM-WF-PIPELINE`). The URL SLUG is a
 * separate concern and is still normalized by `slugifyWorkflowName`; the
 * display name now preserves the caller's casing and spacing verbatim.
 */
function normalizeWorkflowName(name: string): string {
  return name.trim();
}

/**
 * `cluster_id` is caller-supplied; the FK alone only proves the cluster
 * exists SOMEWHERE — without this check a member of workspace A could
 * point a workflow at workspace B's cluster (and use the FK error as an
 * existence oracle for cluster uuids).
 */
async function assertClusterInWorkspace(
  clusterId: string,
  workspaceId: string
): Promise<void> {
  const db = supabaseAdmin();
  const { data } = await db
    .from("clusters")
    .select("id")
    .eq("id", clusterId)
    .eq("workspace_id", workspaceId)
    .maybeSingle();
  if (!data) {
    throw new HttpError(404, "CLUSTER_NOT_FOUND", "Cluster not found");
  }
}

/** Live attachment counts/names for a workflow row (list-shape fields). */
async function attachmentSummary(
  workflowId: string,
  scope: WorkflowScope
): Promise<
  Pick<
    WorkflowRow,
    | "knowledge_base_count"
    | "skill_count"
    | "knowledge_base_names"
    | "skill_names"
  >
> {
  const [knowledge_bases, skills] = await Promise.all([
    listAttachedKnowledgeBasesById(workflowId, scope),
    listAttachedSkillsById(workflowId, scope),
  ]);
  return {
    knowledge_base_count: knowledge_bases.length,
    skill_count: skills.length,
    knowledge_base_names: knowledge_bases.map((k) => k.name),
    skill_names: skills.map((s) => s.name),
  };
}

// ── CRUD ─────────────────────────────────────────────────────────────

export async function listWorkflows(
  scope: WorkflowScope
): Promise<WorkflowRow[]> {
  const db = supabaseAdmin();
  const { data, error } = await db
    .from("workflows")
    .select(SELECT_COLS)
    .eq("workspace_id", scope.workspaceId)
    .is("deleted_at", null)
    .order("created_at", { ascending: false });
  if (error) throw error;

  // Team scoping: drop teams-mode workflows the caller can't read, and
  // remember which KBs they can read so hidden KB names don't leak into
  // knowledge_base_names. One batch query covers both resource types.
  const allRows = (data || []) as Array<
    Omit<
      WorkflowRow,
      | "knowledge_base_count"
      | "skill_count"
      | "knowledge_base_names"
      | "skill_names"
    >
  >;
  if (allRows.length === 0) return [];
  const access = await listEffectiveAccess(scope.workspaceId, scope.userId, {
    role: scope.role,
  });
  const rows =
    access === null
      ? allRows.filter((r) => r.access_mode !== "teams")
      : allRows.filter(
          (r) =>
            r.user_id === scope.userId ||
            resolveLevel(access, "workflow", r.id, r.access_mode) !== null
        );
  if (rows.length === 0) return [];
  const ids = rows.map((r) => r.id);

  const [kbLinkRes, skillLinkRes, stepRes] = await Promise.all([
    db
      .from("workflow_knowledge_bases")
      .select("workflow_id, knowledge_base_id")
      .in("workflow_id", ids)
      .eq("workspace_id", scope.workspaceId),
    db
      .from("workflow_skills")
      .select("workflow_id, skill_id")
      .in("workflow_id", ids)
      .eq("workspace_id", scope.workspaceId),
    db
      .from("workflow_steps")
      .select("workflow_id")
      .in("workflow_id", ids)
      .eq("workspace_id", scope.workspaceId),
  ]);
  if (kbLinkRes.error) throw kbLinkRes.error;
  if (skillLinkRes.error) throw skillLinkRes.error;
  if (stepRes.error) throw stepRes.error;

  // Grouped step count per workflow (cheap: one indexed id column, tallied
  // client-side) so every tab shows a step count, not just the active one.
  const stepCountByWf = new Map<string, number>();
  for (const s of stepRes.data || [])
    stepCountByWf.set(s.workflow_id, (stepCountByWf.get(s.workflow_id) ?? 0) + 1);

  const kbIds = [
    ...new Set((kbLinkRes.data || []).map((r) => r.knowledge_base_id)),
  ];
  const skillIds = [...new Set((skillLinkRes.data || []).map((r) => r.skill_id))];

  const kbNameById = new Map<string, string>();
  if (kbIds.length > 0) {
    const { data: kbRows, error: kbErr } = await db
      .from("knowledge_bases")
      .select("id, name, deleted_at, access_mode, created_by")
      .in("id", kbIds)
      .eq("workspace_id", scope.workspaceId);
    if (kbErr) throw kbErr;
    for (const k of kbRows || []) {
      if (k.deleted_at !== null) continue;
      // Don't leak names of teams-mode KBs the caller can't read.
      const kbReadable =
        k.created_by === scope.userId ||
        (access !== null &&
          resolveLevel(
            access,
            "knowledge_base",
            k.id,
            k.access_mode as "workspace" | "teams"
          ) !== null);
      if (kbReadable) kbNameById.set(k.id, k.name);
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
    for (const s of skillRows || [])
      if (s.deleted_at === null) skillNameById.set(s.id, s.name);
  }

  const kbNamesByWf = new Map<string, string[]>();
  for (const link of kbLinkRes.data || []) {
    const name = kbNameById.get(link.knowledge_base_id);
    if (!name) continue;
    const arr = kbNamesByWf.get(link.workflow_id) || [];
    arr.push(name);
    kbNamesByWf.set(link.workflow_id, arr);
  }
  const skillNamesByWf = new Map<string, string[]>();
  for (const link of skillLinkRes.data || []) {
    const name = skillNameById.get(link.skill_id);
    if (!name) continue;
    const arr = skillNamesByWf.get(link.workflow_id) || [];
    arr.push(name);
    skillNamesByWf.set(link.workflow_id, arr);
  }

  return rows.map((r) => {
    const knowledge_base_names = kbNamesByWf.get(r.id) || [];
    const skill_names = skillNamesByWf.get(r.id) || [];
    return {
      ...r,
      step_count: stepCountByWf.get(r.id) ?? 0,
      knowledge_base_count: knowledge_base_names.length,
      skill_count: skill_names.length,
      knowledge_base_names,
      skill_names,
    };
  });
}

export async function getWorkflow(
  idOrSlug: string,
  scope: WorkflowScope
): Promise<WorkflowDetail> {
  const db = supabaseAdmin();
  const id = await resolveWorkflowId(idOrSlug, scope);
  const { data: wf, error } = await db
    .from("workflows")
    .select(SELECT_COLS)
    .eq("id", id)
    .eq("workspace_id", scope.workspaceId)
    .single();
  if (error || !wf) throw new HttpError(404, "WORKFLOW_NOT_FOUND", `Workflow not found: ${idOrSlug}`);

  // Team scoping: 404 teams-mode workflows for members outside every
  // granted team (admins and the creator pass).
  await requireEffectiveAccess(
    scope.userId,
    scope.workspaceId,
    "workflow",
    wf.id,
    "read",
    { role: scope.role }
  );

  const [knowledge_bases, skills, graph] = await Promise.all([
    listAttachedKnowledgeBasesById(wf.id, scope),
    listAttachedSkillsById(wf.id, scope),
    composeWorkflow(scope.workspaceId, wf.id),
  ]);

  return {
    ...wf,
    step_count: graph?.nodes.length ?? 0,
    knowledge_base_count: knowledge_bases.length,
    skill_count: skills.length,
    knowledge_base_names: knowledge_bases.map((k) => k.name),
    skill_names: skills.map((s) => s.name),
    knowledge_bases,
    skills,
    graph,
  };
}

export async function createWorkflow(
  req: WorkflowCreateRequest,
  scope: WorkflowScope
): Promise<WorkflowRow> {
  const db = supabaseAdmin();
  const name = normalizeWorkflowName(req.name);
  if (req.clusterId) {
    await assertClusterInWorkspace(req.clusterId, scope.workspaceId);
  }

  // Slug pick → insert is a TOCTOU window, and every workflow is born
  // with the same default name, so concurrent creates routinely race to
  // the same slug. On a unique violation, re-read the slugs and retry
  // with a fresh suffix instead of surfacing a 500.
  const MAX_SLUG_RETRIES = 3;
  for (let attempt = 0; ; attempt++) {
    // Live rows only — a soft-deleted workflow's slug is recyclable (the
    // slug uniqueness is now partial on `deleted_at IS NULL`), so it must
    // not push the new workflow onto a `-2` suffix.
    const { data: existing } = await db
      .from("workflows")
      .select("slug")
      .eq("workspace_id", scope.workspaceId)
      .is("deleted_at", null);
    const existingSlugs = (existing || []).map((r) => r.slug);
    const slug = slugifyWorkflowName(name, existingSlugs);

    const insert: Record<string, unknown> = {
      workspace_id: scope.workspaceId,
      user_id: scope.userId,
      name,
      slug,
      description: req.description ?? null,
      cluster_id: req.clusterId ?? null,
    };
    if (req.id) insert.id = req.id;

    const { data: wf, error } = await db
      .from("workflows")
      .insert(insert)
      .select(SELECT_COLS)
      .single();
    if (error) {
      const slugRace =
        error.code === "23505" && /slug/i.test(error.message ?? "");
      if (slugRace && attempt < MAX_SLUG_RETRIES) continue;
      throw error;
    }
    if (!wf) throw new Error("Failed to create workflow");

    return {
      ...wf,
      step_count: 0,
      knowledge_base_count: 0,
      skill_count: 0,
      knowledge_base_names: [],
      skill_names: [],
    };
  }
}

export async function updateWorkflow(
  idOrSlug: string,
  req: WorkflowUpdateRequest,
  scope: WorkflowScope
): Promise<WorkflowRow> {
  const db = supabaseAdmin();
  const id = await resolveWorkflowId(idOrSlug, scope);

  const { data: wf, error: lookupError } = await db
    .from("workflows")
    .select(SELECT_COLS)
    .eq("id", id)
    .eq("workspace_id", scope.workspaceId)
    .single();
  if (lookupError || !wf) throw new HttpError(404, "WORKFLOW_NOT_FOUND", `Workflow not found: ${idOrSlug}`);

  await requireEffectiveAccess(
    scope.userId,
    scope.workspaceId,
    "workflow",
    wf.id,
    "edit",
    { role: scope.role }
  );

  const update: Record<string, unknown> = {};
  const nextName = req.name ? normalizeWorkflowName(req.name) : undefined;
  if (nextName && nextName !== wf.name) {
    const { data: existing } = await db
      .from("workflows")
      .select("slug")
      .eq("workspace_id", scope.workspaceId)
      .is("deleted_at", null);
    const existingSlugs = (existing || [])
      .map((r) => r.slug)
      .filter((s) => s !== wf.slug);
    update.name = nextName;
    update.slug = slugifyWorkflowName(nextName, existingSlugs);
  }
  if (req.description !== undefined) update.description = req.description;
  if (req.clusterId !== undefined) {
    if (req.clusterId) {
      await assertClusterInWorkspace(req.clusterId, scope.workspaceId);
    }
    update.cluster_id = req.clusterId;
  }
  // Layout merge-except-empty semantics (shared with ontology
  // repository.updateCluster via `mergeStoredLayout`): a non-empty patch
  // shallow-merges per node id over the stored layout so two tabs each
  // dragging a different step don't clobber each other; an explicit `{}`
  // resets, replacing every stored position back to pure auto-layout.
  if (req.layout !== undefined) {
    update.layout = mergeStoredLayout((wf.layout ?? null) as GraphLayout | null, req.layout);
  }

  if (Object.keys(update).length > 0) {
    update.updated_at = new Date().toISOString();
    const { error: updateError } = await db
      .from("workflows")
      .update(update)
      .eq("id", wf.id)
      .eq("workspace_id", scope.workspaceId);
    if (updateError) throw updateError;
  }

  const { data: updated, error: refetchError } = await db
    .from("workflows")
    .select(SELECT_COLS)
    .eq("id", wf.id)
    .single();
  if (refetchError || !updated) throw refetchError || new Error("Refetch failed");

  // Real attachment + step summary — zeroed fields here would make a rename
  // response look like the workflow lost all its KBs/skills/steps.
  const [summary, step_count] = await Promise.all([
    attachmentSummary(wf.id, scope),
    countSteps(db, scope.workspaceId, wf.id),
  ]);
  return { ...updated, step_count, ...summary };
}

export async function deleteWorkflow(
  idOrSlug: string,
  scope: WorkflowScope
): Promise<void> {
  const db = supabaseAdmin();
  const byId = isUuid(idOrSlug);

  // Resolve the LIVE row first so the access gate always sees it before the
  // soft-delete runs. An already-trashed workflow resolves to no row here →
  // idempotent no-op (a re-delete keeps the original tombstone timestamp).
  const { data: wf, error: lookupError } = await db
    .from("workflows")
    .select("id")
    .eq(byId ? "id" : "slug", idOrSlug)
    .eq("workspace_id", scope.workspaceId)
    .is("deleted_at", null)
    .maybeSingle();
  if (lookupError) throw lookupError;
  // No live row -> nothing to delete (idempotent).
  if (!wf?.id) return;

  await requireEffectiveAccess(
    scope.userId,
    scope.workspaceId,
    "workflow",
    wf.id,
    "edit",
    { role: scope.role }
  );

  // F-11: soft-delete — stamp `deleted_at` instead of physically deleting.
  // Steps, edges, and KB/skill junctions are always read via the parent
  // workflow, so filtering reads on `workflows.deleted_at` hides the whole
  // graph without touching those rows; `restoreWorkflow` brings it all back
  // by clearing the stamp. (The old hard DELETE cascaded them away with no
  // recovery.) The `deleted_at IS NULL` guard keeps the write idempotent.
  const { error } = await db
    .from("workflows")
    .update({ deleted_at: new Date().toISOString() })
    .eq("id", wf.id)
    .eq("workspace_id", scope.workspaceId)
    .is("deleted_at", null);
  if (error) throw error;
}

/**
 * Restore a soft-deleted workflow (recovery, not deletion) — clears its
 * `deleted_at` so the workflow and its steps/edges reappear. Admin/editor
 * gated like delete. Because a trashed workflow's slug is recyclable, a LIVE
 * workflow may already hold that slug; restoring as-is would violate the
 * partial-unique slug index, so we re-slug off a fresh suffix in that case
 * (mirrors createWorkflow's slug picking).
 */
export async function restoreWorkflow(
  idOrSlug: string,
  scope: WorkflowScope
): Promise<WorkflowRow> {
  const db = supabaseAdmin();
  const byId = isUuid(idOrSlug);

  // Find the TRASHED row. resolveWorkflowId can't be reused — it only
  // resolves LIVE workflows (deleted_at IS NULL).
  const { data: wf, error: lookupError } = await db
    .from("workflows")
    .select(SELECT_COLS)
    .eq(byId ? "id" : "slug", idOrSlug)
    .eq("workspace_id", scope.workspaceId)
    .not("deleted_at", "is", null)
    .maybeSingle();
  if (lookupError) throw lookupError;
  if (!wf?.id) {
    throw new HttpError(
      404,
      "WORKFLOW_NOT_FOUND",
      `No soft-deleted workflow matches: ${idOrSlug}`
    );
  }

  await requireEffectiveAccess(
    scope.userId,
    scope.workspaceId,
    "workflow",
    wf.id,
    "edit",
    { role: scope.role }
  );

  const update: Record<string, unknown> = {
    deleted_at: null,
    updated_at: new Date().toISOString(),
  };
  const { data: liveSlugRows } = await db
    .from("workflows")
    .select("slug")
    .eq("workspace_id", scope.workspaceId)
    .is("deleted_at", null);
  const liveSlugs = (liveSlugRows || []).map((r) => r.slug);
  if (liveSlugs.includes(wf.slug)) {
    update.slug = slugifyWorkflowName(wf.name, liveSlugs);
  }

  const { data: restored, error: updateError } = await db
    .from("workflows")
    .update(update)
    .eq("id", wf.id)
    .eq("workspace_id", scope.workspaceId)
    .select(SELECT_COLS)
    .single();
  if (updateError || !restored)
    throw updateError || new Error("Failed to restore workflow");

  const [summary, step_count] = await Promise.all([
    attachmentSummary(wf.id, scope),
    countSteps(db, scope.workspaceId, wf.id),
  ]);
  return { ...restored, step_count, ...summary };
}

/**
 * Workspace-scoped trash view: every soft-deleted workflow the caller may
 * see. Team-scoped exactly like `listWorkflows` — a trashed teams-mode
 * workflow stays hidden from members who couldn't read it live (this is
 * over-restrictive for grantees, since the effective-access index only
 * covers live rows, but it never leaks; the creator and admins always see
 * their own trash).
 */
export async function listTrash(
  scope: WorkflowScope
): Promise<WorkflowTrashRow[]> {
  const db = supabaseAdmin();
  const { data, error } = await db
    .from("workflows")
    .select("id, slug, name, description, access_mode, user_id, deleted_at")
    .eq("workspace_id", scope.workspaceId)
    .not("deleted_at", "is", null)
    .order("deleted_at", { ascending: false });
  if (error) throw error;

  const allRows = (data || []) as Array<{
    id: string;
    slug: string;
    name: string;
    description: string | null;
    access_mode: "workspace" | "teams";
    user_id: string | null;
    deleted_at: string;
  }>;
  if (allRows.length === 0) return [];

  const access = await listEffectiveAccess(scope.workspaceId, scope.userId, {
    role: scope.role,
  });
  const rows =
    access === null
      ? allRows.filter((r) => r.access_mode !== "teams")
      : allRows.filter(
          (r) =>
            r.user_id === scope.userId ||
            resolveLevel(access, "workflow", r.id, r.access_mode) !== null
        );

  return rows.map((r) => ({
    id: r.id,
    slug: r.slug,
    name: r.name,
    description: r.description,
    deleted_at: r.deleted_at,
  }));
}

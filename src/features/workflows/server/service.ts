import "server-only";

import { supabaseAdmin } from "@/shared/supabase/admin";
import { isUuid } from "@/shared/lib/id/uuid";
import { normalizeClusterName } from "@/shared/lib/cluster-name";
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
}

export interface WorkflowScope {
  workspaceId: string;
  userId: string;
  /** Caller's workspace role — used for team-access resolution without refetching membership. */
  role: Role;
  source: "user" | "agent";
}

const SELECT_COLS =
  "id, slug, name, description, cluster_id, access_mode, user_id, created_at, updated_at";

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
  const name = normalizeClusterName(req.name);
  if (req.clusterId) {
    await assertClusterInWorkspace(req.clusterId, scope.workspaceId);
  }

  // Slug pick → insert is a TOCTOU window, and every workflow is born
  // with the same default name, so concurrent creates routinely race to
  // the same slug. On a unique violation, re-read the slugs and retry
  // with a fresh suffix instead of surfacing a 500.
  const MAX_SLUG_RETRIES = 3;
  for (let attempt = 0; ; attempt++) {
    const { data: existing } = await db
      .from("workflows")
      .select("slug")
      .eq("workspace_id", scope.workspaceId);
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
  const nextName = req.name ? normalizeClusterName(req.name) : undefined;
  if (nextName && nextName !== wf.name) {
    const { data: existing } = await db
      .from("workflows")
      .select("slug")
      .eq("workspace_id", scope.workspaceId);
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

  // Resolve the row first so the access gate always sees it before the
  // DELETE runs.
  const { data: wf, error: lookupError } = await db
    .from("workflows")
    .select("id")
    .eq(byId ? "id" : "slug", idOrSlug)
    .eq("workspace_id", scope.workspaceId)
    .maybeSingle();
  if (lookupError) throw lookupError;
  // No row -> nothing to delete (idempotent).
  if (!wf?.id) return;

  await requireEffectiveAccess(
    scope.userId,
    scope.workspaceId,
    "workflow",
    wf.id,
    "edit",
    { role: scope.role }
  );

  // Idempotent: steps, step edges, and junction rows all vanish via FK
  // cascade (workflow_steps / workflow_step_edges / workflow_knowledge_bases
  // / workflow_skills reference workflows ON DELETE CASCADE).
  const { error } = await db
    .from("workflows")
    .delete()
    .eq(byId ? "id" : "slug", idOrSlug)
    .eq("workspace_id", scope.workspaceId);
  if (error) throw error;
}

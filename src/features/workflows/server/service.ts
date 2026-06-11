import "server-only";

import { supabaseAdmin } from "@/shared/supabase/admin";
import { normalizeClusterName } from "@/shared/lib/cluster-name";
import { HttpError } from "@/shared/lib/http-error";
import { slugifyWorkflowName } from "../slug";
import { spawnHeaderPanel } from "./authoring";
import { composeWorkflow, type WorkflowGraph } from "./graph";
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
  created_at: string;
  updated_at: string;
  knowledge_base_count: number;
  skill_count: number;
  knowledge_base_names: string[];
  skill_names: string[];
  /** Set on agent-path create: the canvas header panel spawned with the row. */
  header_panel_id?: string;
}

export interface WorkflowDetail extends WorkflowRow {
  knowledge_bases: WorkflowAttachedKnowledgeBase[];
  skills: WorkflowAttachedSkill[];
  /** Node graph composed from the canvas (header + edge-connected nodes). */
  graph: WorkflowGraph | null;
}

export interface WorkflowCreateRequest {
  /** Client-generated id so the canvas header panel and the row agree. */
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
  source: "user" | "agent";
}

const SELECT_COLS =
  "id, slug, name, description, cluster_id, created_at, updated_at";

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

  const rows = data || [];
  if (rows.length === 0) return [];
  const ids = rows.map((r) => r.id);

  const [kbLinkRes, skillLinkRes] = await Promise.all([
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
  ]);
  if (kbLinkRes.error) throw kbLinkRes.error;
  if (skillLinkRes.error) throw skillLinkRes.error;

  const kbIds = [
    ...new Set((kbLinkRes.data || []).map((r) => r.knowledge_base_id)),
  ];
  const skillIds = [...new Set((skillLinkRes.data || []).map((r) => r.skill_id))];

  const kbNameById = new Map<string, string>();
  if (kbIds.length > 0) {
    const { data: kbRows, error: kbErr } = await db
      .from("knowledge_bases")
      .select("id, name, deleted_at")
      .in("id", kbIds)
      .eq("workspace_id", scope.workspaceId);
    if (kbErr) throw kbErr;
    for (const k of kbRows || [])
      if (k.deleted_at === null) kbNameById.set(k.id, k.name);
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

  const [knowledge_bases, skills, graph] = await Promise.all([
    listAttachedKnowledgeBasesById(wf.id, scope),
    listAttachedSkillsById(wf.id, scope),
    composeWorkflow(scope.workspaceId, wf.id),
  ]);

  return {
    ...wf,
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

    // Agent-created workflows need a header panel on the canvas to be
    // visible + composable (the client create path makes its own header).
    const header_panel_id =
      scope.source === "agent"
        ? await spawnHeaderPanel(wf.id, wf.name, wf.description, scope)
        : undefined;

    return {
      ...wf,
      header_panel_id,
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

  // Real attachment summary — zeroed fields here would make a rename
  // response look like the workflow lost all its KBs/skills.
  return { ...updated, ...(await attachmentSummary(wf.id, scope)) };
}

export async function deleteWorkflow(
  idOrSlug: string,
  scope: WorkflowScope
): Promise<void> {
  const db = supabaseAdmin();
  const isUuid =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
      idOrSlug
    );
  // Idempotent: junction rows + (if any) the row vanish via FK cascade.
  const { error } = await db
    .from("workflows")
    .delete()
    .eq(isUuid ? "id" : "slug", idOrSlug)
    .eq("workspace_id", scope.workspaceId);
  if (error) throw error;
}

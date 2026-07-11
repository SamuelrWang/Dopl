import "server-only";

import { supabaseAdmin } from "@/shared/supabase/admin";
import { isUuid } from "@/shared/lib/id/uuid";
import { CONTEXT_CHAR_BUDGET_PER_FIELD } from "@/config";
import { HttpError } from "@/shared/lib/http-error";
import {
  listEffectiveAccess,
  requireEffectiveAccess,
  resolveLevel,
} from "@/features/teams/server/access";
import {
  computeWorkflowAudience,
  validateWorkflowKbInvariant,
} from "@/features/teams/server/invariant";
import { getResourceAccessMeta } from "@/features/teams/server/repository";
import type { WorkflowScope } from "./service";

// Workflow-level KB/skill attachments. Mirrors the cluster attachment
// reader on the workflow_knowledge_bases / workflow_skills junctions (the
// `workflows` table replaced clusters as the unit agents read). Manual
// two-step joins (not PostgREST embedded resources) for the same reason as
// the cluster reader — embedded `!inner` returned opaque 500s after the
// workspace_id denormalization.

export interface WorkflowAttachedKnowledgeBase {
  knowledge_base_id: string;
  slug: string;
  name: string;
  description: string | null;
  agent_write_enabled: boolean;
  added_at: string;
  entries_index: Array<{
    entry_id: string;
    title: string;
    folder_path: string | null;
  }>;
}

export interface WorkflowAttachedSkill {
  skill_id: string;
  slug: string;
  name: string;
  description: string;
  status: "active" | "draft";
  when_to_use: string;
  body: string;
  added_at: string;
}

/** Resolve a workflow id OR slug to its uuid within the workspace. */
export async function resolveWorkflowId(
  idOrSlug: string,
  scope: WorkflowScope
): Promise<string> {
  const db = supabaseAdmin();
  const { data, error } = await db
    .from("workflows")
    .select("id")
    .eq(isUuid(idOrSlug) ? "id" : "slug", idOrSlug)
    .eq("workspace_id", scope.workspaceId)
    .maybeSingle();
  if (error) throw error;
  if (!data)
    throw new HttpError(404, "WORKFLOW_NOT_FOUND", `Workflow not found: ${idOrSlug}`);
  return data.id;
}

// ── attach / detach (dock = attach) ──────────────────────────────────
//
// Workflows live on the workspace-shared canvas, so a private KB/skill
// can't be attached (it would leak to every member) — same guard as the
// cluster attachments had.

/** Team-scope write gate shared by every attach/detach op. */
export async function requireWorkflowEdit(
  workflowId: string,
  scope: WorkflowScope
): Promise<void> {
  await requireEffectiveAccess(
    scope.userId,
    scope.workspaceId,
    "workflow",
    workflowId,
    "edit",
    { role: scope.role }
  );
}

/**
 * Workflow↔KB invariant gate: every team (or everyone, for a
 * workspace-mode workflow) that can read this workflow must be able to
 * read each KB about to be attached/referenced. Throws 409 with the
 * conflict payload otherwise; admins may retry with autoGrant.
 */
export async function validateKbsForWorkflow(
  workflowId: string,
  kbIds: string[],
  scope: WorkflowScope,
  opts?: { autoGrant?: boolean }
): Promise<void> {
  if (kbIds.length === 0) return;
  const wfMeta = await getResourceAccessMeta(
    scope.workspaceId,
    "workflow",
    workflowId
  );
  if (!wfMeta) return;
  await validateWorkflowKbInvariant({
    workspaceId: scope.workspaceId,
    workflowId,
    workflowName: wfMeta.name,
    kbIds,
    audience: await computeWorkflowAudience(scope.workspaceId, workflowId),
    autoGrant: opts?.autoGrant
      ? { callerId: scope.userId, role: scope.role }
      : undefined,
  });
}

async function assertKbAttachable(
  knowledgeBaseId: string,
  scope: WorkflowScope
): Promise<void> {
  const db = supabaseAdmin();
  const { data, error } = await db
    .from("knowledge_bases")
    .select("id, agent_write_enabled, visibility")
    .eq("id", knowledgeBaseId)
    .eq("workspace_id", scope.workspaceId)
    .is("deleted_at", null)
    .maybeSingle();
  if (error) throw error;
  if (!data)
    throw new HttpError(404, "KNOWLEDGE_BASE_NOT_FOUND", "Knowledge base not found in this workspace");
  if (data.visibility === "private")
    throw new HttpError(403, "PRIVATE_RESOURCE", "This knowledge base is private. Make it public before adding it to a workflow.");
  if (scope.source === "agent" && !data.agent_write_enabled)
    throw new HttpError(403, "AGENT_WRITE_DISABLED", "agent_write_enabled is off for this knowledge base");
}

async function assertSkillAttachable(
  skillId: string,
  scope: WorkflowScope
): Promise<void> {
  const db = supabaseAdmin();
  const { data, error } = await db
    .from("skills")
    .select("id, agent_write_enabled, visibility, access_mode")
    .eq("id", skillId)
    .eq("workspace_id", scope.workspaceId)
    .is("deleted_at", null)
    .maybeSingle();
  if (error) throw error;
  if (!data)
    throw new HttpError(404, "SKILL_NOT_FOUND", "Skill not found in this workspace");
  // Workflows only reference workspace-public skills: every workflow
  // reader must be able to load the skill. (KBs get the richer team
  // invariant machinery; skills keep the simple rule.)
  if (data.visibility === "private")
    throw new HttpError(403, "PRIVATE_RESOURCE", "This skill is private. Make it public before adding it to a workflow.");
  if (data.access_mode === "teams")
    throw new HttpError(403, "PRIVATE_RESOURCE", "This skill is team-scoped. Share it with the whole workspace before adding it to a workflow.");
  if (scope.source === "agent" && !data.agent_write_enabled)
    throw new HttpError(403, "AGENT_WRITE_DISABLED", "agent_write_enabled is off for this skill");
}

export async function attachKnowledgeBase(
  workflowId: string,
  knowledgeBaseId: string,
  scope: WorkflowScope,
  opts?: { autoGrant?: boolean }
): Promise<void> {
  await requireWorkflowEdit(workflowId, scope);
  await assertKbAttachable(knowledgeBaseId, scope);
  await validateKbsForWorkflow(workflowId, [knowledgeBaseId], scope, opts);
  const db = supabaseAdmin();
  const { error } = await db.from("workflow_knowledge_bases").upsert(
    {
      workflow_id: workflowId,
      knowledge_base_id: knowledgeBaseId,
      workspace_id: scope.workspaceId,
      added_by_user_id: scope.userId,
    },
    { onConflict: "workflow_id,knowledge_base_id", ignoreDuplicates: false }
  );
  if (error) throw error;
}

export async function detachKnowledgeBase(
  workflowId: string,
  knowledgeBaseId: string,
  scope: WorkflowScope
): Promise<void> {
  await requireWorkflowEdit(workflowId, scope);
  const db = supabaseAdmin();
  const { error } = await db
    .from("workflow_knowledge_bases")
    .delete()
    .eq("workflow_id", workflowId)
    .eq("knowledge_base_id", knowledgeBaseId)
    .eq("workspace_id", scope.workspaceId);
  if (error) throw error;
}

export async function attachSkill(
  workflowId: string,
  skillId: string,
  scope: WorkflowScope
): Promise<void> {
  await requireWorkflowEdit(workflowId, scope);
  await assertSkillAttachable(skillId, scope);
  const db = supabaseAdmin();
  const { error } = await db.from("workflow_skills").upsert(
    {
      workflow_id: workflowId,
      skill_id: skillId,
      workspace_id: scope.workspaceId,
      added_by_user_id: scope.userId,
    },
    { onConflict: "workflow_id,skill_id", ignoreDuplicates: false }
  );
  if (error) throw error;
}

export async function detachSkill(
  workflowId: string,
  skillId: string,
  scope: WorkflowScope
): Promise<void> {
  await requireWorkflowEdit(workflowId, scope);
  const db = supabaseAdmin();
  const { error } = await db
    .from("workflow_skills")
    .delete()
    .eq("workflow_id", workflowId)
    .eq("skill_id", skillId)
    .eq("workspace_id", scope.workspaceId);
  if (error) throw error;
}

export async function listAttachedKnowledgeBasesById(
  workflowId: string,
  scope: WorkflowScope
): Promise<WorkflowAttachedKnowledgeBase[]> {
  const db = supabaseAdmin();

  type KbRel = {
    id: string;
    slug: string;
    name: string;
    description: string | null;
    agent_write_enabled: boolean;
    access_mode: "workspace" | "teams";
    created_by: string | null;
    deleted_at: string | null;
  };

  const { data: linkRows, error: linkErr } = await db
    .from("workflow_knowledge_bases")
    .select("added_at, knowledge_base_id")
    .eq("workflow_id", workflowId)
    .eq("workspace_id", scope.workspaceId);
  if (linkErr) throw linkErr;

  const kbIdList = (linkRows ?? []).map((r) => r.knowledge_base_id);
  const kbsById = new Map<string, KbRel>();
  if (kbIdList.length > 0) {
    const { data: kbRows, error: kbErr } = await db
      .from("knowledge_bases")
      .select(
        "id, slug, name, description, agent_write_enabled, access_mode, created_by, deleted_at"
      )
      .in("id", kbIdList)
      .eq("workspace_id", scope.workspaceId);
    if (kbErr) throw kbErr;
    for (const kb of kbRows ?? []) kbsById.set(kb.id, kb as KbRel);
  }

  // Team scoping: hide attached teams-mode KBs the caller can't read.
  // The attach-time invariant keeps these rare, but admin autoGrant
  // asymmetries can still produce them — filter defensively.
  const hasScopedKb = [...kbsById.values()].some(
    (kb) => kb.access_mode === "teams" && kb.created_by !== scope.userId
  );
  const access = hasScopedKb
    ? await listEffectiveAccess(scope.workspaceId, scope.userId, {
        role: scope.role,
      })
    : null;
  const kbReadable = (kb: KbRel): boolean => {
    if (kb.access_mode !== "teams" || kb.created_by === scope.userId) return true;
    return (
      access !== null &&
      resolveLevel(access, "knowledge_base", kb.id, kb.access_mode) !== null
    );
  };

  const liveRows = (linkRows ?? [])
    .map((r) => ({
      added_at: r.added_at,
      knowledge_base_id: r.knowledge_base_id,
      kb: kbsById.get(r.knowledge_base_id) ?? null,
    }))
    .filter(
      (r): r is { added_at: string; knowledge_base_id: string; kb: KbRel } =>
        r.kb !== null && r.kb.deleted_at === null && kbReadable(r.kb)
    );
  if (liveRows.length === 0) return [];

  const kbIds = liveRows.map((r) => r.knowledge_base_id);

  const { data: folderRows, error: folderError } = await db
    .from("knowledge_folders")
    .select("id, name, parent_id, knowledge_base_id, deleted_at")
    .in("knowledge_base_id", kbIds)
    .is("deleted_at", null);
  if (folderError) throw folderError;
  const foldersById = new Map<
    string,
    { name: string; parent_id: string | null }
  >();
  for (const f of folderRows || [])
    foldersById.set(f.id, { name: f.name, parent_id: f.parent_id });

  function pathOfFolder(folderId: string | null): string | null {
    if (!folderId) return null;
    const segments: string[] = [];
    let cursor: string | null = folderId;
    const seen = new Set<string>();
    while (cursor && !seen.has(cursor)) {
      seen.add(cursor);
      const f = foldersById.get(cursor);
      if (!f) break;
      segments.unshift(f.name);
      cursor = f.parent_id;
    }
    return segments.length === 0 ? null : segments.join("/");
  }

  const ENTRIES_PER_KB_CAP = 200;
  const { data: entryRows, error: entryError } = await db
    .from("knowledge_entries")
    .select("id, title, folder_id, knowledge_base_id, deleted_at, position")
    .in("knowledge_base_id", kbIds)
    .is("deleted_at", null)
    .order("position", { ascending: true })
    .limit(ENTRIES_PER_KB_CAP * kbIds.length);
  if (entryError) throw entryError;

  const indexByKb = new Map<
    string,
    Array<{ entry_id: string; title: string; folder_path: string | null }>
  >();
  for (const e of entryRows || []) {
    const list = indexByKb.get(e.knowledge_base_id) ?? [];
    if (list.length >= ENTRIES_PER_KB_CAP) continue;
    list.push({
      entry_id: e.id,
      title: e.title,
      folder_path: pathOfFolder(e.folder_id),
    });
    indexByKb.set(e.knowledge_base_id, list);
  }

  return liveRows.map((r) => ({
    knowledge_base_id: r.knowledge_base_id,
    slug: r.kb.slug,
    name: r.kb.name,
    description: r.kb.description,
    agent_write_enabled: r.kb.agent_write_enabled,
    added_at: r.added_at,
    entries_index: indexByKb.get(r.knowledge_base_id) ?? [],
  }));
}

export async function listAttachedSkillsById(
  workflowId: string,
  scope: WorkflowScope
): Promise<WorkflowAttachedSkill[]> {
  const db = supabaseAdmin();

  type SkillRel = {
    id: string;
    slug: string;
    name: string;
    description: string;
    status: "active" | "draft";
    when_to_use: string;
    deleted_at: string | null;
  };

  const { data: linkRows, error: linkErr } = await db
    .from("workflow_skills")
    .select("added_at, skill_id")
    .eq("workflow_id", workflowId)
    .eq("workspace_id", scope.workspaceId);
  if (linkErr) throw linkErr;

  const skillIdList = (linkRows ?? []).map((r) => r.skill_id);
  const skillsById = new Map<string, SkillRel>();
  if (skillIdList.length > 0) {
    const { data: skillRows, error: skillErr } = await db
      .from("skills")
      .select("id, slug, name, description, status, when_to_use, deleted_at")
      .in("id", skillIdList)
      .eq("workspace_id", scope.workspaceId);
    if (skillErr) throw skillErr;
    for (const s of skillRows ?? []) skillsById.set(s.id, s as SkillRel);
  }

  const liveRows = (linkRows ?? [])
    .map((r) => ({
      added_at: r.added_at,
      skill_id: r.skill_id,
      skill: skillsById.get(r.skill_id) ?? null,
    }))
    .filter(
      (r): r is { added_at: string; skill_id: string; skill: SkillRel } =>
        r.skill !== null && r.skill.deleted_at === null
    );
  if (liveRows.length === 0) return [];

  const liveSkillIds = liveRows.map((r) => r.skill_id);
  const bodyBySkillId = new Map<string, string>();
  const { data: fileRows, error: fileErr } = await db
    .from("skill_files")
    .select("skill_id, body")
    .in("skill_id", liveSkillIds)
    .eq("name", "SKILL.md")
    .is("deleted_at", null);
  if (fileErr) throw fileErr;
  for (const f of fileRows ?? []) bodyBySkillId.set(f.skill_id, f.body ?? "");

  return liveRows.map((r) => ({
    skill_id: r.skill_id,
    slug: r.skill.slug,
    name: r.skill.name,
    description: r.skill.description,
    status: r.skill.status,
    when_to_use: r.skill.when_to_use,
    body: (bodyBySkillId.get(r.skill_id) ?? "").slice(
      0,
      CONTEXT_CHAR_BUDGET_PER_FIELD
    ),
    added_at: r.added_at,
  }));
}

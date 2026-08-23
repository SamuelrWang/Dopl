import "server-only";
import { supabaseAdmin } from "@/shared/supabase/admin";
import type { AgentTemplate, TemplateField, TemplateVisibility } from "../types";
import {
  AGENT_TEMPLATE_COLS,
  mapAgentTemplateRow,
  type AgentTemplateRow,
} from "./dto";

/**
 * Raw I/O for agent templates and their two junctions.
 *
 * ⚠ THE SERVICE-ROLE CLIENT BYPASSES RLS. Every query here takes a
 * `workspaceId` the service sets from the auth context, and every one of them
 * uses it — on this path the service IS the fence and the SELECT policies in
 * `20260822200000_agent_templates.sql` are not a backstop, they are the fence
 * for the OTHER path (PostgREST / a session token reading directly).
 */

// ─── Templates ──────────────────────────────────────────────────────────

export async function listTemplatesForWorkspace(
  workspaceId: string
): Promise<AgentTemplate[]> {
  const db = supabaseAdmin();
  const { data, error } = await db
    .from("agent_templates")
    .select(AGENT_TEMPLATE_COLS)
    .eq("workspace_id", workspaceId)
    // Matches `agent_templates_workspace_name_idx`. Name order, not created
    // order: the client groups by visibility and renders alphabetically inside
    // each group, so the server hands back the order it will display in.
    .order("name", { ascending: true });
  if (error) throw error;
  return ((data ?? []) as unknown as AgentTemplateRow[]).map((r) =>
    mapAgentTemplateRow(r)
  );
}

export async function findTemplateById(
  workspaceId: string,
  id: string
): Promise<AgentTemplate | null> {
  const db = supabaseAdmin();
  const { data, error } = await db
    .from("agent_templates")
    .select(AGENT_TEMPLATE_COLS)
    .eq("workspace_id", workspaceId)
    .eq("id", id)
    .maybeSingle();
  if (error) throw error;
  return data
    ? mapAgentTemplateRow(data as unknown as AgentTemplateRow)
    : null;
}

export interface InsertTemplateArgs {
  workspaceId: string;
  name: string;
  description: string | null;
  instructions: string | null;
  model: string | null;
  fields: TemplateField[];
  visibility: TemplateVisibility;
  createdBy: string | null;
}

export async function insertTemplate(
  args: InsertTemplateArgs
): Promise<AgentTemplate> {
  const db = supabaseAdmin();
  const { data, error } = await db
    .from("agent_templates")
    .insert({
      workspace_id: args.workspaceId,
      name: args.name,
      description: args.description,
      instructions: args.instructions,
      model: args.model,
      fields: args.fields,
      visibility: args.visibility,
      created_by: args.createdBy,
    })
    .select(AGENT_TEMPLATE_COLS)
    .single();
  if (error || !data) {
    throw error || new Error("Failed to insert agent template");
  }
  return mapAgentTemplateRow(data as unknown as AgentTemplateRow);
}

/** ⚠ `undefined` = leave the column alone, `null` = clear it. The service
 *  translates an absent PATCH key into `undefined`; both reach here. */
export interface UpdateTemplatePatch {
  name?: string;
  description?: string | null;
  instructions?: string | null;
  model?: string | null;
  fields?: TemplateField[];
  /** ⚠ The repo trusts whatever it gets — the service decides who may
   *  re-scope, exactly as `updateSkillRow` documents. */
  visibility?: TemplateVisibility;
}

export async function updateTemplateRow(
  workspaceId: string,
  id: string,
  patch: UpdateTemplatePatch
): Promise<AgentTemplate> {
  const db = supabaseAdmin();
  const update: Record<string, unknown> = {};
  if (patch.name !== undefined) update.name = patch.name;
  if (patch.description !== undefined) update.description = patch.description;
  if (patch.instructions !== undefined) update.instructions = patch.instructions;
  if (patch.model !== undefined) update.model = patch.model;
  if (patch.fields !== undefined) update.fields = patch.fields;
  if (patch.visibility !== undefined) update.visibility = patch.visibility;
  // ⚠ NO `updated_at` HERE. §12: it is stamped by
  // `agent_templates_touch_updated_at`, so a writer that sets it by hand is
  // fighting the trigger. An empty `update` object would be a no-op UPDATE
  // that still fires the trigger — the service never calls with one.
  const { data, error } = await db
    .from("agent_templates")
    .update(update)
    .eq("workspace_id", workspaceId)
    .eq("id", id)
    .select(AGENT_TEMPLATE_COLS)
    .single();
  if (error || !data) {
    throw error || new Error("Failed to update agent template");
  }
  return mapAgentTemplateRow(data as unknown as AgentTemplateRow);
}

/**
 * ⚠ PERMANENT delete — no trash, no restore (Samuel's standing ruling).
 * Workspace-scoped as defense-in-depth. Both junctions go via
 * `ON DELETE CASCADE`; there is no grant-cleanup trigger to remember because
 * the team linkage is a real FK rather than a polymorphic id.
 */
export async function hardDeleteTemplate(
  workspaceId: string,
  id: string
): Promise<void> {
  const db = supabaseAdmin();
  const { error } = await db
    .from("agent_templates")
    .delete()
    .eq("workspace_id", workspaceId)
    .eq("id", id);
  if (error) throw error;
}

// ─── Team links (agent_template_teams) ──────────────────────────────────

/** Team links for many templates in ONE query — fixed query count per request
 *  regardless of how many templates are team-scoped. */
export async function listTeamLinksForTemplates(
  workspaceId: string,
  templateIds: string[]
): Promise<Array<{ templateId: string; teamId: string }>> {
  if (templateIds.length === 0) return [];
  const db = supabaseAdmin();
  const { data, error } = await db
    .from("agent_template_teams")
    .select("template_id, team_id")
    .eq("workspace_id", workspaceId)
    .in("template_id", templateIds);
  if (error) throw error;
  return ((data ?? []) as Array<{ template_id: string; team_id: string }>).map(
    (r) => ({ templateId: r.template_id, teamId: r.team_id })
  );
}

/** REPLACE-SET: clear, then insert. ⚠ Not a diff — two clients editing the
 *  same sharing set with add/remove verbs is how sets silently diverge, and
 *  the set is small enough that the whole rewrite is cheaper than the
 *  reconciliation. */
export async function replaceTeamLinks(
  workspaceId: string,
  templateId: string,
  teamIds: string[],
  grantedBy: string | null
): Promise<void> {
  const db = supabaseAdmin();
  const del = await db
    .from("agent_template_teams")
    .delete()
    .eq("workspace_id", workspaceId)
    .eq("template_id", templateId);
  if (del.error) throw del.error;
  if (teamIds.length === 0) return;
  const { error } = await db.from("agent_template_teams").insert(
    [...new Set(teamIds)].map((teamId) => ({
      template_id: templateId,
      team_id: teamId,
      workspace_id: workspaceId,
      granted_by: grantedBy,
    }))
  );
  if (error) throw error;
}

/** Team ids the caller belongs to, workspace-scoped. ⚠ Read HERE rather than
 *  imported from `features/teams`, mirroring how `skills/server/repository.ts`
 *  reads `knowledge_bases` directly — a cross-feature import is what §1
 *  forbids, and this is one column of one table. */
export async function listTeamIdsForUser(
  workspaceId: string,
  userId: string
): Promise<string[]> {
  const db = supabaseAdmin();
  const { data, error } = await db
    .from("team_members")
    .select("team_id")
    .eq("workspace_id", workspaceId)
    .eq("user_id", userId);
  if (error) throw error;
  return ((data ?? []) as Array<{ team_id: string }>).map((r) => r.team_id);
}

/** Which of `teamIds` actually exist in this workspace. The service uses the
 *  difference to 403 rather than letting the junction's workspace-guard
 *  trigger surface as an opaque 500. */
export async function filterTeamIdsInWorkspace(
  workspaceId: string,
  teamIds: string[]
): Promise<string[]> {
  if (teamIds.length === 0) return [];
  const db = supabaseAdmin();
  const { data, error } = await db
    .from("teams")
    .select("id")
    .eq("workspace_id", workspaceId)
    .in("id", teamIds);
  if (error) throw error;
  return ((data ?? []) as Array<{ id: string }>).map((r) => r.id);
}

// ─── Knowledge-base attachments ─────────────────────────────────────────

export async function listKnowledgeLinksForTemplates(
  workspaceId: string,
  templateIds: string[]
): Promise<Array<{ templateId: string; knowledgeBaseId: string }>> {
  if (templateIds.length === 0) return [];
  const db = supabaseAdmin();
  const { data, error } = await db
    .from("agent_template_knowledge_bases")
    .select("template_id, knowledge_base_id")
    .eq("workspace_id", workspaceId)
    .in("template_id", templateIds);
  if (error) throw error;
  return (
    (data ?? []) as Array<{ template_id: string; knowledge_base_id: string }>
  ).map((r) => ({
    templateId: r.template_id,
    knowledgeBaseId: r.knowledge_base_id,
  }));
}

/** REPLACE-SET, same argument as `replaceTeamLinks`. */
export async function replaceKnowledgeLinks(
  workspaceId: string,
  templateId: string,
  knowledgeBaseIds: string[],
  addedBy: string | null
): Promise<void> {
  const db = supabaseAdmin();
  const del = await db
    .from("agent_template_knowledge_bases")
    .delete()
    .eq("workspace_id", workspaceId)
    .eq("template_id", templateId);
  if (del.error) throw del.error;
  if (knowledgeBaseIds.length === 0) return;
  const { error } = await db.from("agent_template_knowledge_bases").insert(
    [...new Set(knowledgeBaseIds)].map((knowledgeBaseId) => ({
      template_id: templateId,
      knowledge_base_id: knowledgeBaseId,
      workspace_id: workspaceId,
      added_by_user_id: addedBy,
    }))
  );
  if (error) throw error;
}

/**
 * The visibility facts needed to decide whether the CALLER may attach or see a
 * KB. ⚠ Read from `knowledge_bases` HERE rather than imported from
 * `features/knowledge`, mirroring `skills/server/repository.ts ›
 * listWorkspaceKnowledgeBases` — the same cross-feature-dependency argument.
 * The PREDICATE over these fields lives in `service-shared.ts › canSeeBaseRow`,
 * which is where the knowledge feature's `canSeeBase` rule is mirrored.
 * Soft-deleted bases are EXCLUDED: an attachment to a trashed base is an
 * attachment to nothing.
 */
export interface KnowledgeBaseAccessRow {
  id: string;
  name: string;
  visibility: "public" | "private";
  accessMode: "workspace" | "teams";
  createdBy: string | null;
}

export async function listKnowledgeBaseAccessRows(
  workspaceId: string,
  ids: string[]
): Promise<KnowledgeBaseAccessRow[]> {
  if (ids.length === 0) return [];
  const db = supabaseAdmin();
  const { data, error } = await db
    .from("knowledge_bases")
    .select("id, name, visibility, access_mode, created_by")
    .eq("workspace_id", workspaceId)
    .in("id", ids)
    .is("deleted_at", null);
  if (error) throw error;
  return (
    (data ?? []) as Array<{
      id: string;
      name: string;
      visibility: "public" | "private";
      access_mode: "workspace" | "teams";
      created_by: string | null;
    }>
  ).map((r) => ({
    id: r.id,
    name: r.name,
    visibility: r.visibility,
    accessMode: r.access_mode,
    createdBy: r.created_by,
  }));
}

/**
 * Teams granted on a set of knowledge bases. ⚠ THIS ONE READS
 * `team_resource_access` — the polymorphic grant table the KB feature uses —
 * because mirroring the knowledge access predicate means reading the rows that
 * predicate reads. It is a READ of a fixed `resource_type`; agent-template
 * team links live in their own junction and this file never writes here.
 */
export async function listKnowledgeBaseTeamGrants(
  workspaceId: string,
  knowledgeBaseIds: string[]
): Promise<Array<{ knowledgeBaseId: string; teamId: string }>> {
  if (knowledgeBaseIds.length === 0) return [];
  const db = supabaseAdmin();
  const { data, error } = await db
    .from("team_resource_access")
    .select("resource_id, team_id")
    .eq("workspace_id", workspaceId)
    .eq("resource_type", "knowledge_base")
    .in("resource_id", knowledgeBaseIds);
  if (error) throw error;
  return (
    (data ?? []) as Array<{ resource_id: string; team_id: string }>
  ).map((r) => ({ knowledgeBaseId: r.resource_id, teamId: r.team_id }));
}

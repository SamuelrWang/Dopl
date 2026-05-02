import "server-only";
import { supabaseAdmin } from "@/shared/supabase/admin";
import type { Skill, SkillFile, SkillWriteSource } from "../types";
import {
  SKILL_COLS,
  SKILL_FILE_COLS,
  SKILL_FILE_META_COLS,
  SKILL_SUMMARY_COLS,
  mapSkillFileRow,
  mapSkillRow,
  mapSkillSummaryRow,
  type SkillFileMetaRow,
  type SkillFileRow,
  type SkillRow,
  type SkillSummaryRow,
} from "./dto";

/**
 * Raw I/O for the skills feature. Service-role client bypasses RLS, so
 * every query takes a `workspaceId` filter that the service is
 * responsible for setting from the auth context.
 */

// ─── Skills ─────────────────────────────────────────────────────────

export async function listSkillsForWorkspace(
  workspaceId: string
): Promise<Skill[]> {
  const db = supabaseAdmin();
  const { data, error } = await db
    .from("skills")
    .select(SKILL_SUMMARY_COLS)
    .eq("workspace_id", workspaceId)
    .is("deleted_at", null)
    .order("created_at", { ascending: true });
  if (error) throw error;
  return ((data ?? []) as SkillSummaryRow[]).map(mapSkillSummaryRow);
}

export async function findSkillBySlug(
  workspaceId: string,
  slug: string
): Promise<Skill | null> {
  const db = supabaseAdmin();
  const { data, error } = await db
    .from("skills")
    .select(SKILL_COLS)
    .eq("workspace_id", workspaceId)
    .eq("slug", slug)
    .is("deleted_at", null)
    .maybeSingle();
  if (error) throw error;
  return data ? mapSkillRow(data as SkillRow) : null;
}

export async function findSkillById(
  workspaceId: string,
  id: string,
  includeDeleted = false
): Promise<Skill | null> {
  const db = supabaseAdmin();
  let query = db
    .from("skills")
    .select(SKILL_COLS)
    .eq("workspace_id", workspaceId)
    .eq("id", id);
  if (!includeDeleted) query = query.is("deleted_at", null);
  const { data, error } = await query.maybeSingle();
  if (error) throw error;
  return data ? mapSkillRow(data as SkillRow) : null;
}

export async function listSlugsForWorkspace(
  workspaceId: string
): Promise<string[]> {
  const db = supabaseAdmin();
  const { data, error } = await db
    .from("skills")
    .select("slug")
    .eq("workspace_id", workspaceId)
    .is("deleted_at", null);
  if (error) throw error;
  return ((data ?? []) as Array<{ slug: string }>).map((r) => r.slug);
}

export interface InsertSkillArgs {
  workspaceId: string;
  slug: string;
  name: string;
  description: string;
  whenToUse: string;
  whenNotToUse?: string | null;
  connectors?: unknown[];
  examples?: unknown[];
  recentRuns?: unknown[];
  totalInvocations?: number;
  status?: "active" | "draft";
  agentWriteEnabled?: boolean;
  createdBy: string | null;
  source: SkillWriteSource;
}

export async function insertSkill(args: InsertSkillArgs): Promise<Skill> {
  const db = supabaseAdmin();
  const { data, error } = await db
    .from("skills")
    .insert({
      workspace_id: args.workspaceId,
      slug: args.slug,
      name: args.name,
      description: args.description,
      when_to_use: args.whenToUse,
      when_not_to_use: args.whenNotToUse ?? null,
      connectors: args.connectors ?? [],
      examples: args.examples ?? [],
      recent_runs: args.recentRuns ?? [],
      total_invocations: args.totalInvocations ?? 0,
      status: args.status ?? "active",
      agent_write_enabled: args.agentWriteEnabled ?? false,
      created_by: args.createdBy,
      last_edited_by: args.createdBy,
      last_edited_source: args.source,
    })
    .select(SKILL_COLS)
    .single();
  if (error || !data) throw error || new Error("Failed to insert skill");
  return mapSkillRow(data as SkillRow);
}

export interface UpdateSkillPatch {
  name?: string;
  description?: string;
  whenToUse?: string;
  whenNotToUse?: string | null;
  slug?: string;
  status?: "active" | "draft";
  agentWriteEnabled?: boolean;
  lastEditedBy?: string | null;
  lastEditedSource?: SkillWriteSource;
}

export async function updateSkillRow(
  id: string,
  patch: UpdateSkillPatch
): Promise<Skill> {
  const db = supabaseAdmin();
  const update: Record<string, unknown> = {};
  if (patch.name !== undefined) update.name = patch.name;
  if (patch.description !== undefined) update.description = patch.description;
  if (patch.whenToUse !== undefined) update.when_to_use = patch.whenToUse;
  if (patch.whenNotToUse !== undefined) update.when_not_to_use = patch.whenNotToUse;
  if (patch.slug !== undefined) update.slug = patch.slug;
  if (patch.status !== undefined) update.status = patch.status;
  if (patch.agentWriteEnabled !== undefined)
    update.agent_write_enabled = patch.agentWriteEnabled;
  if (patch.lastEditedBy !== undefined) update.last_edited_by = patch.lastEditedBy;
  if (patch.lastEditedSource !== undefined)
    update.last_edited_source = patch.lastEditedSource;
  const { data, error } = await db
    .from("skills")
    .update(update)
    .eq("id", id)
    .select(SKILL_COLS)
    .single();
  if (error || !data) throw error || new Error("Failed to update skill");
  return mapSkillRow(data as SkillRow);
}

export async function markSkillDeleted(
  id: string,
  deletedAt: string = new Date().toISOString()
): Promise<void> {
  const db = supabaseAdmin();
  const { error } = await db
    .from("skills")
    .update({ deleted_at: deletedAt })
    .eq("id", id);
  if (error) throw error;
}

// ─── Skill files ────────────────────────────────────────────────────

export async function listFilesForSkill(
  skillId: string,
  opts: { includeBody?: boolean } = {}
): Promise<SkillFile[]> {
  const includeBody = opts.includeBody ?? true;
  const db = supabaseAdmin();
  const { data, error } = await db
    .from("skill_files")
    .select(includeBody ? SKILL_FILE_COLS : SKILL_FILE_META_COLS)
    .eq("skill_id", skillId)
    .is("deleted_at", null)
    .order("position", { ascending: true })
    .order("created_at", { ascending: true });
  if (error) throw error;
  if (includeBody) {
    return ((data ?? []) as unknown as SkillFileRow[]).map(mapSkillFileRow);
  }
  return ((data ?? []) as unknown as SkillFileMetaRow[]).map((row) =>
    mapSkillFileRow({ ...row, body: "" })
  );
}

export async function findFileByName(
  skillId: string,
  name: string
): Promise<SkillFile | null> {
  const db = supabaseAdmin();
  const { data, error } = await db
    .from("skill_files")
    .select(SKILL_FILE_COLS)
    .eq("skill_id", skillId)
    .eq("name", name)
    .is("deleted_at", null)
    .maybeSingle();
  if (error) throw error;
  return data ? mapSkillFileRow(data as SkillFileRow) : null;
}

export interface InsertFileArgs {
  workspaceId: string;
  skillId: string;
  name: string;
  body?: string;
  position?: number;
  createdBy: string | null;
  source: SkillWriteSource;
}

export async function insertFile(args: InsertFileArgs): Promise<SkillFile> {
  const db = supabaseAdmin();
  const { data, error } = await db
    .from("skill_files")
    .insert({
      workspace_id: args.workspaceId,
      skill_id: args.skillId,
      name: args.name,
      body: args.body ?? "",
      position: args.position ?? 0,
      created_by: args.createdBy,
      last_edited_by: args.createdBy,
      last_edited_source: args.source,
    })
    .select(SKILL_FILE_COLS)
    .single();
  if (error || !data) throw error || new Error("Failed to insert skill file");
  return mapSkillFileRow(data as SkillFileRow);
}

export interface UpdateFilePatch {
  name?: string;
  body?: string;
  position?: number;
  lastEditedBy?: string | null;
  lastEditedSource?: SkillWriteSource;
}

export async function updateFileRow(
  id: string,
  patch: UpdateFilePatch
): Promise<SkillFile> {
  const db = supabaseAdmin();
  const update: Record<string, unknown> = {};
  if (patch.name !== undefined) update.name = patch.name;
  if (patch.body !== undefined) update.body = patch.body;
  if (patch.position !== undefined) update.position = patch.position;
  if (patch.lastEditedBy !== undefined) update.last_edited_by = patch.lastEditedBy;
  if (patch.lastEditedSource !== undefined)
    update.last_edited_source = patch.lastEditedSource;
  const { data, error } = await db
    .from("skill_files")
    .update(update)
    .eq("id", id)
    .select(SKILL_FILE_COLS)
    .single();
  if (error || !data) throw error || new Error("Failed to update skill file");
  return mapSkillFileRow(data as SkillFileRow);
}

export async function markFileDeleted(
  id: string,
  deletedAt: string = new Date().toISOString()
): Promise<void> {
  const db = supabaseAdmin();
  const { error } = await db
    .from("skill_files")
    .update({ deleted_at: deletedAt })
    .eq("id", id);
  if (error) throw error;
}

// ─── Knowledge bases (cross-feature avoiding) ───────────────────────

/**
 * Lightweight existence check used by the chip resolver.
 *
 * Owns its own query rather than importing from features/knowledge so
 * skills doesn't take a cross-feature dependency (ENGINEERING.md §16).
 */
export async function knowledgeBaseSlugExists(
  workspaceId: string,
  slug: string
): Promise<boolean> {
  const db = supabaseAdmin();
  const { data, error } = await db
    .from("knowledge_bases")
    .select("id")
    .eq("workspace_id", workspaceId)
    .eq("slug", slug)
    .is("deleted_at", null)
    .maybeSingle();
  if (error) throw error;
  return data !== null;
}

/**
 * Lists active workspace KBs as `{slug, name}` pairs for the detail-page
 * picker.
 */
export async function listWorkspaceKnowledgeBases(
  workspaceId: string
): Promise<Array<{ slug: string; name: string }>> {
  const db = supabaseAdmin();
  const { data, error } = await db
    .from("knowledge_bases")
    .select("slug, name")
    .eq("workspace_id", workspaceId)
    .is("deleted_at", null)
    .order("name", { ascending: true });
  if (error) throw error;
  return ((data ?? []) as Array<{ slug: string; name: string }>);
}

// ─── Postgres error helpers ─────────────────────────────────────────

export function pgErrorCode(err: unknown): string | null {
  if (err && typeof err === "object" && "code" in err) {
    return (err as { code?: string }).code ?? null;
  }
  return null;
}

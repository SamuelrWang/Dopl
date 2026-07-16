import "server-only";
import { generatePublicId } from "@/shared/lib/id/public-id";
import { supabaseAdmin } from "@/shared/supabase/admin";
import type {
  Skill,
  SkillFile,
  SkillUsedBy,
  SkillWriteSource,
} from "../types";
import {
  SKILL_BODY_COLS,
  SKILL_COLS,
  SKILL_SUMMARY_COLS,
  mapSkillBodyRow,
  mapSkillRow,
  mapSkillSummaryRow,
  type SkillBodyRow,
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
  workspaceId: string,
  opts: { includeConnectors?: boolean } = {}
): Promise<Skill[]> {
  // The summary projection drops the connectors JSONB to keep the MCP
  // skill_list payload lean; callers that render connector chips (the
  // index page) opt into the full row. mapSkillSummaryRow fills
  // `connectors: []` for the lean shape.
  const includeConnectors = opts.includeConnectors ?? false;
  const db = supabaseAdmin();
  const { data, error } = await db
    .from("skills")
    // Dynamic projection: cast to the full-col string so PostgREST's
    // literal-type inference doesn't explode into a giant union; the
    // row casts below carry the real shape per branch.
    .select((includeConnectors ? SKILL_COLS : SKILL_SUMMARY_COLS) as typeof SKILL_COLS)
    .eq("workspace_id", workspaceId)
    .is("deleted_at", null)
    .order("created_at", { ascending: true });
  if (error) throw error;
  if (includeConnectors) {
    return ((data ?? []) as unknown as SkillRow[]).map((r) => mapSkillRow(r));
  }
  return ((data ?? []) as unknown as SkillSummaryRow[]).map(mapSkillSummaryRow);
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

export async function findSkillByPublicId(
  workspaceId: string,
  publicId: string
): Promise<Skill | null> {
  const db = supabaseAdmin();
  const { data, error } = await db
    .from("skills")
    .select(SKILL_COLS)
    .eq("workspace_id", workspaceId)
    .eq("public_id", publicId)
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
  status?: "active" | "draft";
  agentWriteEnabled?: boolean;
  /** Defaults to `'public'` (matches DB column default). App-level
   *  `createSkill` passes `'private'` for new items. */
  visibility?: "public" | "private";
  /** Optional organizing label; null/omitted = unfiled. */
  folder?: string | null;
  /** Initial SKILL.md body (F-029: body is a column on the skill row). */
  body?: string;
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
      public_id: generatePublicId(),
      name: args.name,
      description: args.description,
      when_to_use: args.whenToUse,
      when_not_to_use: args.whenNotToUse ?? null,
      connectors: args.connectors ?? [],
      status: args.status ?? "active",
      agent_write_enabled: args.agentWriteEnabled ?? false,
      visibility: args.visibility ?? "public",
      folder: args.folder ?? null,
      body: args.body ?? "",
      body_edited_by: args.createdBy,
      body_edited_source: args.source,
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
  /** Full three-way sharing since skill_team_sharing — the service
   *  enforces who may change it; this repo trusts whatever it gets. */
  visibility?: "public" | "private";
  accessMode?: "workspace" | "teams";
  /** Organizing label; null clears it (unfiled). */
  folder?: string | null;
  /** Display metadata (JSONB) — set by seed and duplicate, never by
   *  the REST/MCP update surface. */
  connectors?: unknown[];
  lastEditedBy?: string | null;
  lastEditedSource?: SkillWriteSource;
}

// CAS caveat: since F-029, body writes also UPDATE this row, so the
// skills_touch_updated_at trigger bumps `updated_at` on every body save.
// A client holding an `expectedUpdatedAt` metadata token across a body
// autosave would falsely 412. No caller passes it today — if metadata
// optimistic concurrency is ever adopted, key it on a dedicated clock
// (as body writes do with body_updated_at), not `updated_at`.
export async function updateSkillRow(
  id: string,
  patch: UpdateSkillPatch
): Promise<Skill>;
export async function updateSkillRow(
  id: string,
  patch: UpdateSkillPatch,
  expectedUpdatedAt: string | undefined
): Promise<Skill | null>;
export async function updateSkillRow(
  id: string,
  patch: UpdateSkillPatch,
  expectedUpdatedAt?: string
): Promise<Skill | null> {
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
  if (patch.visibility !== undefined) update.visibility = patch.visibility;
  if (patch.accessMode !== undefined) update.access_mode = patch.accessMode;
  if (patch.folder !== undefined) update.folder = patch.folder;
  if (patch.connectors !== undefined) update.connectors = patch.connectors;
  if (patch.lastEditedBy !== undefined) update.last_edited_by = patch.lastEditedBy;
  if (patch.lastEditedSource !== undefined)
    update.last_edited_source = patch.lastEditedSource;
  // Optimistic concurrency: when expectedUpdatedAt is supplied, the
  // `updated_at` filter makes this an atomic compare-and-swap. 0 rows →
  // the row changed since the caller read it → return null (stale).
  let query = db.from("skills").update(update).eq("id", id);
  if (expectedUpdatedAt !== undefined) {
    query = query.eq("updated_at", expectedUpdatedAt);
  }
  const { data, error } = await query.select(SKILL_COLS).maybeSingle();
  if (error) throw error;
  if (!data) {
    if (expectedUpdatedAt !== undefined) return null;
    throw new Error("Failed to update skill");
  }
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

export async function restoreSkillRow(id: string): Promise<Skill> {
  const db = supabaseAdmin();
  const { data, error } = await db
    .from("skills")
    .update({ deleted_at: null })
    .eq("id", id)
    .select(SKILL_COLS)
    .single();
  if (error || !data) throw error || new Error("Failed to restore skill");
  return mapSkillRow(data as SkillRow);
}

// ─── Skill body (the single SKILL.md, now columns on the skill row) ──

/**
 * Read a live skill's SKILL.md body, synthesized as a `SkillFile` from
 * the body columns. `updatedAt` is `body_updated_at` — the CAS clock /
 * version token. Null when the skill is missing or trashed.
 */
export async function readSkillBody(
  workspaceId: string,
  skillId: string
): Promise<SkillFile | null> {
  const db = supabaseAdmin();
  const { data, error } = await db
    .from("skills")
    .select(SKILL_BODY_COLS)
    .eq("workspace_id", workspaceId)
    .eq("id", skillId)
    .is("deleted_at", null)
    .maybeSingle();
  if (error) throw error;
  return data ? mapSkillBodyRow(data as unknown as SkillBodyRow) : null;
}

export interface UpdateSkillBodyPatch {
  body: string;
  editedBy: string | null;
  editedSource: SkillWriteSource;
}

export async function updateSkillBody(
  skillId: string,
  patch: UpdateSkillBodyPatch
): Promise<SkillFile>;
export async function updateSkillBody(
  skillId: string,
  patch: UpdateSkillBodyPatch,
  expectedBodyUpdatedAt: string | undefined
): Promise<SkillFile | null>;
export async function updateSkillBody(
  skillId: string,
  patch: UpdateSkillBodyPatch,
  expectedBodyUpdatedAt?: string
): Promise<SkillFile | null> {
  const db = supabaseAdmin();
  // body_updated_at is the CAS clock — set explicitly (no trigger drives
  // it; skills_touch_updated_at only moves updated_at). Keeping the two
  // clocks independent is what stops metadata edits from 412-ing a body
  // write and vice versa.
  const update = {
    body: patch.body,
    body_updated_at: new Date().toISOString(),
    body_edited_by: patch.editedBy,
    body_edited_source: patch.editedSource,
  };
  let query = db.from("skills").update(update).eq("id", skillId);
  if (expectedBodyUpdatedAt !== undefined) {
    query = query.eq("body_updated_at", expectedBodyUpdatedAt);
  }
  const { data, error } = await query.select(SKILL_BODY_COLS).maybeSingle();
  if (error) throw error;
  if (!data) {
    if (expectedBodyUpdatedAt !== undefined) return null;
    throw new Error("Failed to update skill body");
  }
  return mapSkillBodyRow(data as unknown as SkillBodyRow);
}

// ─── Trash ──────────────────────────────────────────────────────────

export interface DeletedSkillRows {
  skills: Skill[];
}

/**
 * Returns every soft-deleted skill in the workspace, newest-first.
 * Service exposes this as the trash view.
 */
export async function listDeletedForWorkspace(
  workspaceId: string
): Promise<DeletedSkillRows> {
  const db = supabaseAdmin();

  const skillsRes = await db
    .from("skills")
    .select(SKILL_COLS)
    .eq("workspace_id", workspaceId)
    .not("deleted_at", "is", null)
    .order("deleted_at", { ascending: false });
  if (skillsRes.error) throw skillsRes.error;

  return {
    skills: ((skillsRes.data ?? []) as SkillRow[]).map((r) => mapSkillRow(r)),
  };
}

/**
 * Hard-delete skills trashed before `iso` across all workspaces. Used
 * by the nightly cron. Service-role only — bypasses RLS, must be called
 * from a privileged context. The SKILL.md body + version history ride on
 * the skill row / skill_versions FK, so one delete removes it all.
 *
 * Returns a count for system_events logging.
 */
export async function hardDeleteOlderThanGlobal(
  iso: string
): Promise<{ skills: number }> {
  const db = supabaseAdmin();

  const skillsRes = await db
    .from("skills")
    .delete({ count: "exact" })
    .not("deleted_at", "is", null)
    .lt("deleted_at", iso);
  if (skillsRes.error) throw skillsRes.error;

  return {
    skills: skillsRes.count ?? 0,
  };
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

// ─── Used-by (attachment graph) ─────────────────────────────────────

/** Workflows referencing a skill (for the detail insights). */
export async function listSkillUsedBy(
  workspaceId: string,
  skillId: string
): Promise<SkillUsedBy> {
  const db = supabaseAdmin();
  const { data, error } = await db
    .from("workflow_skills")
    .select("workflows(id, name)")
    .eq("workspace_id", workspaceId)
    .eq("skill_id", skillId);
  if (error) throw error;
  type WorkflowJoin = { workflows: { id: string; name: string } | null };
  return {
    workflows: ((data ?? []) as unknown as WorkflowJoin[])
      .map((r) => r.workflows)
      .filter((w): w is NonNullable<typeof w> => w !== null),
  };
}

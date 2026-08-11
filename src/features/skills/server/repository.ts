import "server-only";
import { generatePublicId } from "@/shared/lib/id/public-id";
import { supabaseAdmin } from "@/shared/supabase/admin";
import type {
  Skill,
  SkillFile,
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

/** The row shape for one skill insert — shared by the single and batch forms
 *  so the column defaults can never drift between them. */
function skillInsertRow(args: InsertSkillArgs) {
  return {
    workspace_id: args.workspaceId,
    slug: args.slug,
    public_id: generatePublicId(),
    name: args.name,
    description: args.description,
    when_to_use: args.whenToUse,
    when_not_to_use: args.whenNotToUse ?? null,
    connectors: args.connectors ?? [],
    status: args.status ?? "active",
    // Default writable-by-agents, matching knowledge_bases + createSkill's
    // `?? true`. Callers that want a resource read-only to agents (the seed)
    // pass `false` EXPLICITLY so the intent is legible and can't be flipped
    // by a default change (audit F-10b consistency).
    agent_write_enabled: args.agentWriteEnabled ?? true,
    visibility: args.visibility ?? "public",
    folder: args.folder ?? null,
    body: args.body ?? "",
    body_edited_by: args.createdBy,
    body_edited_source: args.source,
    created_by: args.createdBy,
    last_edited_by: args.createdBy,
    last_edited_source: args.source,
  };
}

export async function insertSkill(args: InsertSkillArgs): Promise<Skill> {
  const db = supabaseAdmin();
  const { data, error } = await db
    .from("skills")
    .insert(skillInsertRow(args))
    .select(SKILL_COLS)
    .single();
  if (error || !data) throw error || new Error("Failed to insert skill");
  return mapSkillRow(data as SkillRow);
}

/**
 * Insert many skills in ONE statement. For the new-workspace seed, which
 * inserted its starter skills one awaited round-trip at a time on the
 * post-signup redirect path. Rows come back in insert order (`RETURNING`),
 * but callers should key off `slug` rather than index.
 */
export async function insertSkills(argsList: InsertSkillArgs[]): Promise<Skill[]> {
  if (argsList.length === 0) return [];
  const db = supabaseAdmin();
  const { data, error } = await db
    .from("skills")
    .insert(argsList.map(skillInsertRow))
    .select(SKILL_COLS);
  if (error || !data) throw error || new Error("Failed to insert skills");
  return (data as SkillRow[]).map((row) => mapSkillRow(row));
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

/**
 * PERMANENTLY delete a skill. Deletion is immediate and irreversible —
 * there is no trash (2026-08-07). Workspace-scoped as defense-in-depth.
 * The SKILL.md body lives in columns on this row (F-029); skill_versions,
 * and skill_events cascade via `ON DELETE CASCADE`.
 */
export async function hardDeleteSkill(
  workspaceId: string,
  id: string
): Promise<void> {
  const db = supabaseAdmin();
  const { error } = await db
    .from("skills")
    .delete()
    .eq("id", id)
    .eq("workspace_id", workspaceId);
  if (error) throw error;
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
  // body_updated_at is the CAS clock. A dedicated BEFORE-UPDATE trigger
  // (skills_touch_body_updated_at) stamps it with Postgres `now()` —
  // microsecond precision — whenever `body` changes, so two writes in the
  // same JS millisecond can't mint colliding tokens and defeat the CAS
  // (F-25). It fires ONLY on a body change, keeping this clock independent
  // of skills.updated_at (moved by skills_touch_updated_at on metadata
  // edits): metadata PATCHes never touch it, and a body write never
  // false-412s a metadata precondition.
  const update = {
    body: patch.body,
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

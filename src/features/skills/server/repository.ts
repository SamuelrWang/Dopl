import "server-only";
import { generatePublicId } from "@/shared/lib/id/public-id";
import { supabaseAdmin } from "@/shared/supabase/admin";
import { readClient } from "@/shared/supabase/caller-client";
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
 * Raw I/O for skills.
 *
 * 🔒 TWO CLIENTS, AND WHICH ONE A FUNCTION TAKES IS THE WHOLE OF RLS PHASE 2
 * (Wave B B12), exactly as `knowledge/server/repository-bases.ts` documents for
 * phase 1. `readClient()` is the CALLER's client when `RLS_CALLER_SCOPED_READS`
 * is on and `supabaseAdmin()` otherwise, so with the flag off this file behaves
 * exactly as it did.
 *
 *   * **A read that answers "what may this caller see" takes `readClient()`.**
 *     With the flag on the row filter is `skills_member_select`
 *     (`20260921120000_rls_phase2_policies`), written to EQUAL
 *     `service-shared.ts › canSeeSkill`; the predicate stays until the flag has
 *     run a release.
 *   * **A read that answers a SYSTEM question keeps `supabaseAdmin()`** and says
 *     so at the call site. Scoped to the caller it would answer a different
 *     question and answer it wrongly — a slug "free" because someone else's
 *     private skill holds it.
 *   * **Writes are unchanged.** INSERT/UPDATE/DELETE stay on the service role
 *     until RLS plan phase 4, and every one of them still carries the
 *     `workspaceId` filter the service sets from the auth context.
 */

// ─── Skills ─────────────────────────────────────────────────────────

export async function listSkillsForWorkspace(
  workspaceId: string,
  opts: { includeConnectors?: boolean } = {}
): Promise<Skill[]> {
  // Summary projection drops the connectors JSONB to keep skill_list lean;
  // mapSkillSummaryRow fills `connectors: []` for that shape.
  const includeConnectors = opts.includeConnectors ?? false;
  const db = readClient();
  const { data, error } = await db
    .from("skills")
    // ⚠ Cast to the full-col string so PostgREST's literal-type inference
    // doesn't explode into a giant union; row casts below carry real shapes.
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
  const db = readClient();
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
  const db = readClient();
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
  const db = readClient();
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

/** ⚠ SERVICE ROLE ON PURPOSE — slug uniqueness is a SYSTEM question. Scoped to
 *  the caller it would report a slug free because the row holding it is someone
 *  else's private skill, and the next insert would hit the unique index. */
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
  /** Defaults `'public'` (DB column default); `createSkill` passes
   *  `'private'`. */
  visibility?: "public" | "private";
  /** null/omitted = unfiled. */
  folder?: string | null;
  /** Initial SKILL.md body (a column on the skill row). */
  body?: string;
  createdBy: string | null;
  source: SkillWriteSource;
}

/** Shared by the single and batch inserts so column defaults can't drift
 *  between them. */
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
    // Agent-writable by default, matching knowledge_bases + createSkill's
    // `?? true`. Callers wanting agent-read-only (the seed) pass `false`
    // EXPLICITLY so a default change can't silently flip them.
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

/** Insert many skills in ONE statement — the seed sits on the post-signup
 *  redirect path. ⚠ Key off `slug`, not insert order. */
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
  /** ⚠ Repo trusts whatever it gets — the service enforces who may
   *  re-scope. */
  visibility?: "public" | "private";
  accessMode?: "workspace" | "teams";
  /** null clears it (unfiled). */
  folder?: string | null;
  /** Display metadata (JSONB). Set by seed and duplicate, never by the
   *  REST/MCP update surface. */
  connectors?: unknown[];
  lastEditedBy?: string | null;
  lastEditedSource?: SkillWriteSource;
}

// ⚠ CAS caveat: body writes UPDATE this row too, so skills_touch_updated_at
// bumps `updated_at` on every body save. An `expectedUpdatedAt` metadata
// token held across a body autosave would falsely 412. No caller passes one
// today — if metadata CAS is ever adopted, give it a dedicated clock (as
// body writes have body_updated_at), not `updated_at`.
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
  // With expectedUpdatedAt the `updated_at` filter makes this an atomic CAS.
  // 0 rows → row changed since the caller read it → null (stale).
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
 * ⚠ PERMANENT delete — no trash, no restore. Workspace-scoped as
 * defense-in-depth. Body lives in columns on this row; skill_versions and
 * skill_events go via `ON DELETE CASCADE`.
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

// ─── Skill body (the single SKILL.md, columns on the skill row) ──────

/** Body synthesized as a `SkillFile` from the body columns. `updatedAt` is
 *  `body_updated_at` — the CAS clock. Null when missing or trashed. */
export async function readSkillBody(
  workspaceId: string,
  skillId: string
): Promise<SkillFile | null> {
  const db = readClient();
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
  // ⚠ body_updated_at is the CAS clock. skills_touch_body_updated_at
  // (BEFORE UPDATE) stamps Postgres `now()` — microsecond precision, so two
  // writes in the same JS millisecond can't mint colliding tokens. Fires
  // ONLY on a body change, keeping it independent of skills.updated_at:
  // metadata PATCHes never touch it, body writes never false-412 metadata.
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
 * Existence check for the chip resolver. Queried here rather than imported from
 * features/knowledge to avoid a cross-feature dependency.
 *
 * ⚠ `readClient()` THOUGH THE TABLE BELONGS TO PHASE 1. "Is this chip
 * available?" is a visibility question about a knowledge base, and
 * `knowledge_bases_member_select` (`20260919120000`) is already written to equal
 * `canSeeBase` — so with the flag on a chip pointing at a base the caller cannot
 * read reports unavailable, which is what the badge means. ⚠ NOTHING IN THIS
 * FEATURE RE-STATES `canSeeBase`; that would be the F-278 shape.
 */
export async function knowledgeBaseSlugExists(
  workspaceId: string,
  slug: string
): Promise<boolean> {
  const db = readClient();
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

/** The KB picker's rows. ⚠ Caller-scoped for the same reason, and it closes
 *  more: this list has no service-side visibility filter at all, so on the
 *  service role it names every base in the workspace including other people's
 *  private ones (F-574). The policy is the only fence it has ever had. */
export async function listWorkspaceKnowledgeBases(
  workspaceId: string
): Promise<Array<{ slug: string; name: string }>> {
  const db = readClient();
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

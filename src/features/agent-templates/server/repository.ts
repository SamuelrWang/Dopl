import "server-only";
import { supabaseAdmin } from "@/shared/supabase/admin";
import { readClient } from "@/shared/supabase/caller-client";
import { personalWriteWorkspaceId, resolveShelfScope } from "@/shared/tenancy/personal-container";
import type {
  AgentTemplate,
  TemplateField,
  TemplateShelf,
  TemplateVisibility,
} from "../types";
import {
  AGENT_TEMPLATE_COLS,
  mapAgentTemplateRow,
  type AgentTemplateRow,
} from "./dto";

/**
 * Raw I/O for agent templates and their two junctions.
 *
 * 🔒 TWO CLIENTS, AND WHICH ONE A FUNCTION TAKES IS THE WHOLE OF RLS PHASE 2
 * (Wave B B12); `knowledge/server/repository-bases.ts` states the same split for
 * phase 1. `readClient()` is the CALLER's client when `RLS_CALLER_SCOPED_READS`
 * is on and `supabaseAdmin()` otherwise, so with the flag off this file behaves
 * exactly as it did — the service is still the fence and the SELECT policies are
 * still only the fence for the OTHER path (PostgREST / a session token reading
 * directly). With the flag on those become the SAME path, which is the point.
 *
 *   * **A read that answers "what may this caller see" takes `readClient()`,**
 *     and the row filter becomes `agent_templates_member_select` →
 *     `can_current_user_read_agent_template()`, repaired in
 *     `20260921120000_rls_phase2_policies` to equal `service-shared.ts ›
 *     canSeeTemplate` — including arm 2, the shared-credential arm the SQL did
 *     not have.
 *   * **A read of a table this slice does NOT cover keeps `supabaseAdmin()`**
 *     and says so at the call site. `team_members` and `teams` are not among the
 *     seven covered tables; scoping them to the caller would put a policy this
 *     slice never audited between the service and its own membership lookup.
 *   * **Writes are unchanged.** INSERT/UPDATE/DELETE stay on the service role
 *     until RLS plan phase 4, `workspaceId` filter and all.
 */

// ─── Templates ──────────────────────────────────────────────────────────

/**
 * One workspace's templates, optionally narrowed to ONE SHELF.
 *
 * ⚠ `shelf` UNDEFINED IS "NO FILTER", NOT A DEFAULT SHELF. Every caller that
 * omits it means the whole workspace: the launch picker, `resolveTemplateRef`,
 * and MCP all ride the unfiltered path.
 *
 * ⚠ **THE SHELF IS A TENANCY, NOT A `WHERE` (2026-09-02, slice B15)** — the
 * sibling of `knowledge/server/repository-bases.ts › listBasesForWorkspace`,
 * which carries the argument. `shelf="home"` is the caller's PERSONAL CONTAINER,
 * decided by `shared/tenancy/personal-container.ts › resolveShelfScope`.
 */
export async function listTemplatesForWorkspace(
  workspaceId: string,
  shelf?: TemplateShelf
): Promise<AgentTemplate[]> {
  const db = readClient();
  const scope = await resolveShelfScope(workspaceId, shelf);
  const { data, error } = await db
    .from("agent_templates")
    .select(AGENT_TEMPLATE_COLS)
    .in("workspace_id", scope.workspaceIds)
    // Matches `agent_templates_workspace_name_idx`. Name order, not created
    // order: the client groups by visibility and renders alphabetically inside
    // each group, so the server hands back the order it will display in.
    .order("name", { ascending: true });
  if (error) throw error;
  return ((data ?? []) as unknown as AgentTemplateRow[]).map((r) =>
    mapAgentTemplateRow(r)
  );
}

/**
 * WHICH of `templateIds` are on the caller's PERSONAL shelf — the fold behind
 * `GET /api/agent-templates › homeScopedTemplateIds` (2026-08-28).
 *
 * ⚠ **A TENANCY QUESTION SINCE 2026-09-02 (slice B15).** It selected the
 * `home_scoped` flag; the column is dropped and the question is "is this row in
 * my personal container". The answer set and the sibling key are unchanged — ids
 * the caller was ALREADY shown, labelled, never a new column on the row.
 *
 * ⚠ CALLERS MUST PASS THE POST-VISIBILITY LIST. This applies no `canSeeTemplate`
 * of its own; the id set IS the fence, the same contract
 * `knowledge/server/repository-bases.ts › listHomeScopedBaseIds` keeps.
 *
 * ⚠ THE SAME RESOLVER THE LIST USES: a second spelling of "is this row personal"
 * is how a label comes to disagree with the list it labels.
 */
export async function listHomeScopedTemplateIds(
  workspaceId: string,
  templateIds: string[]
): Promise<string[]> {
  if (templateIds.length === 0) return [];
  const scope = await resolveShelfScope(workspaceId, "home");
  if (scope.workspaceIds.length === 0) return [];
  const { data, error } = await readClient()
    .from("agent_templates")
    .select("id")
    .in("workspace_id", scope.workspaceIds)
    .in("id", templateIds);
  if (error) throw error;
  return ((data ?? []) as unknown as Array<{ id: string }>).map((r) => r.id);
}

export async function findTemplateById(
  workspaceId: string,
  id: string
): Promise<AgentTemplate | null> {
  const db = readClient();
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
  /**
   * WHICH SHELF (`../types.ts › TemplateShelf`). ⚠ **A ROUTING FLAG, NOT A
   * COLUMN, SINCE 2026-09-02 (slice B15)** — it decides the row's `workspace_id`
   * and nothing stores it. Absent = the container the call is in, so every
   * existing caller is unchanged; only `createTemplate` ever passes `true`.
   */
  homeScoped?: boolean;
  createdBy: string | null;
}

/**
 * 🔒 THE PERSONAL WRITE LANDS IN THE CONTAINER OR IT REFUSES (B15) — the sibling
 * of `repository-bases.ts › insertBase`, which carries the argument.
 * ⚠ Resolved BEFORE the chain, never inline in the insert literal — an `await`
 * between `.from()` and `.insert()` interleaves a second query into the builder.
 */
export async function insertTemplate(
  args: InsertTemplateArgs
): Promise<AgentTemplate> {
  const db = supabaseAdmin();
  const workspaceId = await personalWriteWorkspaceId(args);
  const { data, error } = await db
    .from("agent_templates")
    .insert({
      workspace_id: workspaceId,
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
  // fighting the trigger.
  //
  // ⚠ THE EMPTY PATCH IS A READ, NOT A WRITE (F-404, 2026-09-02). This used to
  // assert "the service never calls with one" and hand `{}` straight to
  // PostgREST. It was false: a KB-ONLY patch — `dopl_agent(op="update",
  // knowledge_bases=[…])` — sets none of the six scalar columns, so `update`
  // stayed `{}`, PostgREST cannot emit `UPDATE … SET` with no assignments, and
  // the raw driver object thrown below had no arm in `http-mapping.ts` and
  // surfaced to the agent as an unexplained INTERNAL_ERROR 500. The junction
  // write that WAS the point of the call had already been fenced upstream and
  // still had to run, so the caller lost a legitimate write to a no-op.
  // `workspaces/server/service.ts › renameWorkspace` guards this exact class
  // the same way.
  // Reading the row back keeps the return contract total for every caller
  // instead of making each one remember the special case, and it deliberately
  // does NOT fire the touch trigger: a no-op UPDATE that bumps `updated_at` is
  // the second thing the old comment was right to want to avoid.
  const query =
    Object.keys(update).length === 0
      ? db.from("agent_templates").select(AGENT_TEMPLATE_COLS)
      : db.from("agent_templates").update(update).select(AGENT_TEMPLATE_COLS);
  const { data, error } = await query
    .eq("workspace_id", workspaceId)
    .eq("id", id)
    .single();
  if (error || !data) {
    throw error || new Error("Failed to update agent template");
  }
  return mapAgentTemplateRow(data as unknown as AgentTemplateRow);
}

/**
 * ⚠ PERMANENT delete — no trash, no restore (Samuel's standing ruling).
 * Workspace-scoped as defense-in-depth. The knowledge-base junction goes via
 * `ON DELETE CASCADE`.
 * ⚠ THE TEAM LINKAGE NO LONGER DOES, AND THAT IS WHY THE TRIGGER EXISTS. Since
 * `20260914120000` the team link is a `resource_grants` row whose `resource_id`
 * is POLYMORPHIC and carries no foreign key, so nothing cascades — the
 * `resource_grants_cleanup` AFTER DELETE trigger on `agent_templates` is what
 * purges it, exactly as every other grantable type has had for its own rows.
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

// ─── Team links (resource_grants, scope_type='team') ────────────────────

/**
 * The TEAM-VISIBILITY slice of `resource_grants` this feature owns, as an
 * equality filter set for `.match()`. ⚠ STATED ONCE AND SPREAD INTO EVERY
 * STATEMENT: one grant table now carries channel, container and team scopes over
 * five resource types, so a statement missing either half reads — or worse,
 * DELETES — another lane's rows.
 *
 * ⚠ `20260915120000_drop_agent_template_teams.sql` retired the dedicated
 * junction. **Team visibility on a template did not change**: `visibility='team'`
 * still means "members of a linked team", the links are still a replace-set, and
 * writes are still creator-or-workspace-admin. `20260822200000` §2 split the
 * junction off the polymorphic table because its `level` would always be
 * `'read'` (F-277) — it still is, and now a CHECK says so.
 */
const TEMPLATE_TEAM_GRANT = {
  scope_type: "team",
  resource_type: "agent_template",
} as const;

/** Team links for many templates in ONE query — fixed query count per request
 *  regardless of how many templates are team-scoped. */
export async function listTeamLinksForTemplates(
  workspaceId: string,
  templateIds: string[]
): Promise<Array<{ templateId: string; teamId: string }>> {
  if (templateIds.length === 0) return [];
  const db = readClient();
  const { data, error } = await db
    .from("resource_grants")
    .select("resource_id, scope_id")
    .match({ workspace_id: workspaceId, ...TEMPLATE_TEAM_GRANT })
    .in("resource_id", templateIds);
  if (error) throw error;
  return (
    (data ?? []) as Array<{ resource_id: string; scope_id: string }>
  ).map((r) => ({ templateId: r.resource_id, teamId: r.scope_id }));
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
    .from("resource_grants")
    .delete()
    .match({
      workspace_id: workspaceId,
      resource_id: templateId,
      ...TEMPLATE_TEAM_GRANT,
    });
  if (del.error) throw del.error;
  if (teamIds.length === 0) return;
  const { error } = await db.from("resource_grants").insert(
    [...new Set(teamIds)].map((teamId) => ({
      ...TEMPLATE_TEAM_GRANT,
      scope_id: teamId,
      resource_id: templateId,
      workspace_id: workspaceId,
      // A template team link has no edit concept; the CHECK admits read|edit on
      // a team scope and the write path stays creator-or-admin.
      level: "read",
      // 🔒 The GRANTOR `enforce_resource_grant()` judges, carried over verbatim
      // from the junction's `granted_by`. NULL falls back to the old
      // same-container equality, which is what a team link has always been.
      created_by: grantedBy,
    }))
  );
  if (error) throw error;
}

/** Team ids the caller belongs to, workspace-scoped. ⚠ Read HERE rather than
 *  imported from `features/teams`, mirroring how `skills/server/repository.ts`
 *  reads `knowledge_bases` directly — a cross-feature import is what §1
 *  forbids, and this is one column of one table.
 *  ⚠ SERVICE ROLE: `team_members` is not one of the seven tables phases 1–2
 *  cover, and this is the input to the TS predicate rather than a row the caller
 *  is shown. A policy this slice never audited must not silently narrow it. */
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
 *  trigger surface as an opaque 500.
 *  ⚠ SERVICE ROLE: a WRITE-path validation over `teams`, which this slice does
 *  not cover — and a team the caller cannot read is still a team that exists,
 *  which is the question being asked. */
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
//
// ⚠ LIFTED INTO A SIBLING AND RE-EXPORTED (F-562, 2026-09-02). This file reached
// the 500-line cap when B11's dual-write and B12's `readClient()` both landed in
// it at the batch-2 integration, and the house move at the cap is to lift a
// marked section rather than shave a comment. Every name below still resolves
// through `repository.ts`, so no caller changed.
export {
  listKnowledgeLinksForTemplates,
  replaceKnowledgeLinks,
  listKnowledgeBaseAccessRows,
  listKnowledgeBaseTeamGrants,
  type KnowledgeBaseAccessRow,
} from "./repository-knowledge-links";

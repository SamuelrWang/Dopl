import "server-only";
import { supabaseAdmin } from "@/shared/supabase/admin";

/**
 * 🔒 THE ONE READ IN THIS FEATURE THAT LOOKS OUTSIDE A SINGLE WORKSPACE — the
 * "it lives elsewhere" classification behind the launch refusal (T35).
 *
 * ⚠ **SPLIT OUT OF `repository.ts` ON 2026-09-01, AT THE 500-LINE CAP AND ON A
 * REAL SEAM.** That file's standing rule is that every query takes a
 * `workspaceId` the service set from the auth context and every one of them uses
 * it — the service IS the fence there. These two do not have that shape: one
 * ANSWERS the workspace set, the other spans it. Keeping them in their own file
 * is what stops that rule from acquiring an exception nobody notices.
 *
 * ⚠ THE SERVICE-ROLE CLIENT BYPASSES RLS here as it does there, so the `.or()`
 * in {@link findTemplateTenancyRows} and the membership set its caller supplies
 * ARE the fence. Read them together; neither is sufficient alone.
 *
 * ⚠ ONE CONSUMER, BY DESIGN: `service-resolve-ref.ts › classifyMissingTemplateRef`.
 * A second caller of these is a second place that decides what may be named
 * across a tenancy boundary, which is the thing this file exists to keep to one.
 */

/**
 * Workspaces the caller is an ACTIVE member of.
 *
 * ⚠ `workspace_members` READ HERE rather than imported from
 * `features/workspaces`, the same argument `listTeamIdsForUser` and
 * `listKnowledgeBaseAccessRows` already make in this file: §1 forbids the
 * cross-feature import and this is one column of one table.
 *
 * ⚠ `status='active'` — a pending invitation is not a membership and a revoked
 * one is not either. `workspaces/server/repository.ts › findMembership` carries
 * the scar of omitting it (a removed admin still measured as one).
 */
export async function listWorkspaceIdsForUser(
  userId: string
): Promise<string[]> {
  const db = supabaseAdmin();
  const { data, error } = await db
    .from("workspace_members")
    .select("workspace_id")
    .eq("user_id", userId)
    .eq("status", "active");
  if (error) throw error;
  return ((data ?? []) as Array<{ workspace_id: string }>).map(
    (r) => r.workspace_id
  );
}

/**
 * One template row, with the TENANCY it lives in — the only row shape in this
 * file that reaches outside a single workspace.
 *
 * ⚠ `homeScoped` IS THE SECOND (AND LAST) PLACE THE COLUMN IS SELECTED — see
 * {@link listHomeScopedTemplateIds}, which used to be the only one. It is read
 * here to LABEL a tenancy ("your personal shelf") and never projected onto an
 * `AgentTemplate`; `AGENT_TEMPLATE_COLS` still omits it, so no DTO grows a
 * shelf field by way of this query.
 */
export interface TemplateTenancyRow {
  id: string;
  name: string;
  workspaceId: string;
  workspaceName: string;
  workspaceKind: string;
  homeScoped: boolean;
}

/**
 * 🔒 TEMPLATES MATCHING `ref` THAT THE CALLER COULD ALREADY LIST FOR THEMSELVES,
 * ACROSS THE WORKSPACES THEY BELONG TO — the read behind the "it lives
 * elsewhere" refusal (T35).
 *
 * ⚠ **IT IS NOT AN ORACLE, AND THE `.or()` IS THE WHOLE REASON.** Two arms only:
 *   - `created_by = <caller>` — the caller's OWN rows, which they can already
 *     read on every list surface they have; and
 *   - `visibility = 'workspace'` — rows arm 1 of `canSeeTemplate` grants to
 *     EVERY member unconditionally.
 * A `private` or `team` row belonging to ANOTHER member matches neither arm, so
 * no answer built on this read can ever name one. That is the property, not a
 * side effect: naming a workspace a stranger's private template lives in would
 * be the existence oracle the whole 404-never-403 surface closes.
 *
 * ⚠ `workspaceIds` MUST BE THE CALLER'S OWN MEMBERSHIPS ({@link
 * listWorkspaceIdsForUser}); this function applies no membership check of its
 * own, exactly as `listHomeScopedTemplateIds` takes a post-visibility id set.
 *
 * ⚠ NAME MATCHING IS CASE-INSENSITIVE EXACT, never a prefix or a pattern:
 * `ilike` is passed an escaped literal so a `%` in a caller-supplied name
 * matches a `%` and not "anything".
 */
export async function findTemplateTenancyRows(
  userId: string,
  workspaceIds: string[],
  ref: { id?: string; name?: string }
): Promise<TemplateTenancyRow[]> {
  if (workspaceIds.length === 0) return [];
  const db = supabaseAdmin();
  let query = db
    .from("agent_templates")
    .select(
      "id, name, workspace_id, home_scoped, workspace:workspaces!inner(name, kind)"
    )
    .in("workspace_id", workspaceIds)
    .or(`created_by.eq.${userId},visibility.eq.workspace`);
  if (ref.id !== undefined) query = query.eq("id", ref.id);
  else if (ref.name !== undefined) {
    query = query.ilike("name", ref.name.replace(/[%_\\]/g, "\\$&"));
  } else return [];
  const { data, error } = await query;
  if (error) throw error;
  // ⚠ Supabase types a 1:1 embed as an array; flatten through `unknown` exactly
  // as `workspaces/server/repository.ts › listWorkspacesForUser` does.
  const rows = (data ?? []) as unknown as Array<{
    id: string;
    name: string;
    workspace_id: string;
    home_scoped: boolean;
    workspace:
      | { name: string; kind: string }
      | Array<{ name: string; kind: string }>;
  }>;
  return rows.map((r) => {
    const ws = Array.isArray(r.workspace) ? r.workspace[0] : r.workspace;
    return {
      id: r.id,
      name: r.name,
      workspaceId: r.workspace_id,
      workspaceName: ws?.name ?? "",
      workspaceKind: ws?.kind ?? "standard",
      homeScoped: r.home_scoped === true,
    };
  });
}

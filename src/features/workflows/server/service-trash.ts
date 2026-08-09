import "server-only";

import { supabaseAdmin } from "@/shared/supabase/admin";
import { isUuid } from "@/shared/lib/id/uuid";
import { HttpError } from "@/shared/lib/http-error";
import { requireEffectiveAccess } from "@/features/teams/server/access";
import { slugifyWorkflowName } from "../slug";
import { countSteps } from "./repository";
import {
  SELECT_COLS,
  attachmentSummary,
  filterTeamVisibleWorkflows,
  type WorkflowRow,
  type WorkflowScope,
  type WorkflowTrashRow,
} from "./service-shared";

/**
 * Soft-delete lifecycle for workflows: trash (soft-delete), restore, and the
 * feature-local trash list. Split out of `service.ts` (which stayed over the
 * 500-line cap once F-11 soft-delete landed); CRUD reads/writes remain there
 * and re-export these so the `service.ts` import path is unchanged.
 */

export async function deleteWorkflow(
  idOrSlug: string,
  scope: WorkflowScope
): Promise<void> {
  const db = supabaseAdmin();
  const byId = isUuid(idOrSlug);

  // Resolve the LIVE row first so the access gate always sees it before the
  // soft-delete runs. An already-trashed workflow resolves to no row here →
  // idempotent no-op (a re-delete keeps the original tombstone timestamp).
  const { data: wf, error: lookupError } = await db
    .from("workflows")
    .select("id")
    .eq(byId ? "id" : "slug", idOrSlug)
    .eq("workspace_id", scope.workspaceId)
    .is("deleted_at", null)
    .maybeSingle();
  if (lookupError) throw lookupError;
  // No live row -> nothing to delete (idempotent).
  if (!wf?.id) return;

  await requireEffectiveAccess(
    scope.userId,
    scope.workspaceId,
    "workflow",
    wf.id,
    "edit",
    { role: scope.role }
  );

  // F-11: soft-delete — stamp `deleted_at` instead of physically deleting.
  // Steps, edges, and KB/skill junctions are always read via the parent
  // workflow, so filtering reads on `workflows.deleted_at` hides the whole
  // graph without touching those rows; `restoreWorkflow` brings it all back
  // by clearing the stamp. (The old hard DELETE cascaded them away with no
  // recovery.) The `deleted_at IS NULL` guard keeps the write idempotent.
  const { error } = await db
    .from("workflows")
    .update({ deleted_at: new Date().toISOString() })
    .eq("id", wf.id)
    .eq("workspace_id", scope.workspaceId)
    .is("deleted_at", null);
  if (error) throw error;
}

/**
 * Restore a soft-deleted workflow (recovery, not deletion) — clears its
 * `deleted_at` so the workflow and its steps/edges reappear. Admin/editor
 * gated like delete. Because a trashed workflow's slug is recyclable, a LIVE
 * workflow may already hold that slug; restoring as-is would violate the
 * partial-unique slug index, so we re-slug off a fresh suffix in that case
 * (mirrors createWorkflow's slug picking).
 */
export async function restoreWorkflow(
  idOrSlug: string,
  scope: WorkflowScope
): Promise<WorkflowRow> {
  const db = supabaseAdmin();
  const byId = isUuid(idOrSlug);

  // Find the TRASHED row. resolveWorkflowId can't be reused — it only
  // resolves LIVE workflows (deleted_at IS NULL).
  const { data: wf, error: lookupError } = await db
    .from("workflows")
    .select(SELECT_COLS)
    .eq(byId ? "id" : "slug", idOrSlug)
    .eq("workspace_id", scope.workspaceId)
    .not("deleted_at", "is", null)
    .maybeSingle();
  if (lookupError) throw lookupError;
  if (!wf?.id) {
    throw new HttpError(
      404,
      "WORKFLOW_NOT_FOUND",
      `No soft-deleted workflow matches: ${idOrSlug}`
    );
  }

  await requireEffectiveAccess(
    scope.userId,
    scope.workspaceId,
    "workflow",
    wf.id,
    "edit",
    { role: scope.role }
  );

  const update: Record<string, unknown> = {
    deleted_at: null,
    updated_at: new Date().toISOString(),
  };
  const { data: liveSlugRows } = await db
    .from("workflows")
    .select("slug")
    .eq("workspace_id", scope.workspaceId)
    .is("deleted_at", null);
  const liveSlugs = (liveSlugRows || []).map((r) => r.slug);
  if (liveSlugs.includes(wf.slug)) {
    update.slug = slugifyWorkflowName(wf.name, liveSlugs);
  }

  const { data: restored, error: updateError } = await db
    .from("workflows")
    .update(update)
    .eq("id", wf.id)
    .eq("workspace_id", scope.workspaceId)
    .select(SELECT_COLS)
    .single();
  if (updateError || !restored)
    throw updateError || new Error("Failed to restore workflow");

  const [summary, step_count] = await Promise.all([
    attachmentSummary(wf.id, scope),
    countSteps(db, scope.workspaceId, wf.id),
  ]);
  return { ...restored, step_count, ...summary };
}

/**
 * Workspace-scoped trash view: every soft-deleted workflow the caller may
 * see. Team-scoped exactly like `listWorkflows` — a trashed teams-mode
 * workflow stays hidden from members who couldn't read it live (this is
 * over-restrictive for grantees, since the effective-access index only
 * covers live rows, but it never leaks; the creator and admins always see
 * their own trash).
 */
export async function listTrash(
  scope: WorkflowScope
): Promise<WorkflowTrashRow[]> {
  const db = supabaseAdmin();
  const { data, error } = await db
    .from("workflows")
    .select("id, slug, name, description, access_mode, user_id, deleted_at")
    .eq("workspace_id", scope.workspaceId)
    .not("deleted_at", "is", null)
    .order("deleted_at", { ascending: false });
  if (error) throw error;

  const allRows = (data || []) as Array<{
    id: string;
    slug: string;
    name: string;
    description: string | null;
    access_mode: "workspace" | "teams";
    user_id: string | null;
    deleted_at: string;
  }>;
  if (allRows.length === 0) return [];

  // Same visibility rule as the live listing and the cluster rollup — one
  // definition, in `service-shared.ts`.
  const rows = await filterTeamVisibleWorkflows(allRows, scope);

  return rows.map((r) => ({
    id: r.id,
    slug: r.slug,
    name: r.name,
    description: r.description,
    deleted_at: r.deleted_at,
  }));
}

/*
 * REMOVED 2026-08-07 (retirement §2b): `listTrashedWorkflows` and
 * `purgeWorkflow`.
 *
 * Both existed only to serve the unified workspace Trash page. That page and
 * its aggregator (`src/features/trash/server/service.ts`) are gone, no
 * `/api/workflows/**` purge route ever existed, and every sibling feature's
 * trash module went with its own. These two were the leftovers — exported,
 * re-exported from `service.ts`, and called by nothing.
 *
 * `deleteWorkflow`, `restoreWorkflow` and `listTrash` above STAY: D3 keeps
 * their routes live (`/api/workflows/trash`).
 */

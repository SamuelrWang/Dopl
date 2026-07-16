import "server-only";

import { supabaseAdmin } from "@/shared/supabase/admin";
import { HttpError } from "@/shared/lib/http-error";
import { WORKFLOW_PANEL_SIZE } from "@/features/canvas/types";
import type { WorkflowScope } from "./service";

/**
 * Header-panel authoring for a workflow: creating, syncing, and
 * resolving the `canvas_panels` row of type `workflow`. `resolveHeaderPanelId`
 * is the shared entry point every authoring op calls first — it spawns a
 * header on demand for legacy workflows that predate the pivot.
 *
 * Agent panel ids use `wf-` / `n-` prefixes so they never collide with the
 * client's `panel-N` counter.
 */

export function shortId(prefix: string): string {
  return `${prefix}-${crypto.randomUUID().slice(0, 8)}`;
}

/** Place a new workflow to the right of all existing panels so it doesn't
 *  overlap current content. */
async function freeOrigin(workspaceId: string): Promise<{ x: number; y: number }> {
  const db = supabaseAdmin();
  const { data } = await db
    .from("canvas_panels")
    .select("x, width")
    .eq("workspace_id", workspaceId);
  let maxRight = 0;
  for (const p of data ?? []) {
    const right = (p.x ?? 0) + (p.width ?? 0);
    if (right > maxRight) maxRight = right;
  }
  return { x: maxRight + 120, y: 80 };
}

/** Insert the workflow's header panel; returns its panel_id. */
export async function spawnHeaderPanel(
  workflowId: string,
  name: string,
  description: string | null,
  scope: WorkflowScope
): Promise<string> {
  const db = supabaseAdmin();
  const origin = await freeOrigin(scope.workspaceId);
  const panelId = shortId("wf");
  const { error } = await db.from("canvas_panels").insert({
    workspace_id: scope.workspaceId,
    panel_id: panelId,
    user_id: scope.userId,
    panel_type: "workflow",
    x: origin.x,
    y: origin.y,
    width: WORKFLOW_PANEL_SIZE.width,
    height: WORKFLOW_PANEL_SIZE.height,
    panel_data: { workflowId, name, description: description ?? "" },
  });
  if (error) throw error;
  return panelId;
}

/**
 * Keep the canvas header panel's label in sync with the workflow row after
 * a rename / description edit. Without this, updateWorkflow changes the row
 * but the header panel keeps its stale create-time name/description on the
 * canvas. resolveHeaderPanelId spawns a header if one is somehow missing
 * (already carrying the fresh values), so this is a no-op in that case.
 */
export async function syncHeaderPanel(
  workflowId: string,
  name: string,
  description: string | null,
  scope: WorkflowScope
): Promise<void> {
  const db = supabaseAdmin();
  const headerId = await resolveHeaderPanelId(workflowId, scope);
  const { error } = await db
    .from("canvas_panels")
    .update({ panel_data: { workflowId, name, description: description ?? "" } })
    .eq("workspace_id", scope.workspaceId)
    .eq("panel_id", headerId);
  if (error) throw error;
}

/**
 * The header panel id for a workflow. Legacy workflows migrated from
 * pre-pivot clusters may have no header panel — rather than 409, spawn one
 * on first authoring op so those workflows become authorable + visible.
 */
export async function resolveHeaderPanelId(
  workflowId: string,
  scope: WorkflowScope
): Promise<string> {
  const db = supabaseAdmin();
  const { data } = await db
    .from("canvas_panels")
    .select("panel_id, panel_data")
    .eq("workspace_id", scope.workspaceId)
    .eq("panel_type", "workflow");
  const header = (data ?? []).find(
    (r) => (r.panel_data as { workflowId?: string } | null)?.workflowId === workflowId
  );
  if (header) return header.panel_id as string;

  const { data: wf } = await db
    .from("workflows")
    .select("name, description")
    .eq("id", workflowId)
    .eq("workspace_id", scope.workspaceId)
    .maybeSingle();
  if (!wf) throw new HttpError(404, "WORKFLOW_NOT_FOUND", `Workflow not found: ${workflowId}`);
  return spawnHeaderPanel(workflowId, wf.name, wf.description ?? null, scope);
}

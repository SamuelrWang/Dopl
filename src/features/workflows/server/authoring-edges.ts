import "server-only";

import { supabaseAdmin } from "@/shared/supabase/admin";
import { HttpError } from "@/shared/lib/http-error";
import { insertEdge } from "@/features/canvas/server/edges";
import { resolveHeaderPanelId } from "./authoring-header";
import {
  buildAdjacency,
  deleteEdgeByPair,
  nodeOwnership,
  reaches,
  reconcileAttachments,
} from "./authoring-shared";
import type { WorkflowScope } from "./service";

/**
 * Per-edge authoring ops: connect two panels (with cross-workflow +
 * cycle guards) and disconnect an edge. Node ops are in `authoring-nodes`;
 * graph-level reconciliation is in `authoring-graph`.
 */

export async function connect(
  workflowId: string,
  from: string,
  to: string,
  scope: WorkflowScope
): Promise<void> {
  const headerId = await resolveHeaderPanelId(workflowId, scope);
  const fromId = from === "header" ? headerId : from;
  const toId = to === "header" ? headerId : to;
  if (fromId === toId) throw new HttpError(400, "SELF_EDGE", "Cannot connect a panel to itself.");

  // Don't let an agent wire in a node that already belongs to a DIFFERENT
  // workflow (it would become dual-homed). Isolated nodes + this workflow's
  // own nodes are fine.
  const own = await nodeOwnership(scope);
  for (const endpoint of [fromId, toId]) {
    if (endpoint === headerId) continue;
    const owners = own.get(endpoint);
    if (owners && [...owners].some((w) => w !== workflowId)) {
      throw new HttpError(400, "NODE_IN_OTHER_WORKFLOW", `Panel ${endpoint} belongs to a different workflow; connect within one workflow.`);
    }
  }

  // Reject a back-edge: adding from→to closes a cycle iff `to` already
  // reaches `from`. Keeps the workflow a DAG (op='get' assumes it).
  const db = supabaseAdmin();
  const { data: curEdges } = await db
    .from("canvas_edges")
    .select("from_panel_id, to_panel_id")
    .eq("workspace_id", scope.workspaceId);
  const adj = buildAdjacency(
    (curEdges ?? []).map((e) => ({ from: e.from_panel_id, to: e.to_panel_id })),
  );
  if (reaches(adj, toId, fromId)) {
    throw new HttpError(
      400,
      "WORKFLOW_CYCLE",
      `Connecting ${from} → ${to} would form a cycle. A workflow must stay acyclic.`,
    );
  }

  await insertEdge(scope.workspaceId, scope.userId, { id: crypto.randomUUID(), fromPanelId: fromId, toPanelId: toId });
  await reconcileAttachments(workflowId, scope);
}

export async function disconnect(
  workflowId: string,
  from: string,
  to: string,
  scope: WorkflowScope
): Promise<void> {
  const headerId = await resolveHeaderPanelId(workflowId, scope);
  const fromId = from === "header" ? headerId : from;
  const toId = to === "header" ? headerId : to;
  const deleted = await deleteEdgeByPair(scope.workspaceId, fromId, toId);
  if (deleted === 0) {
    throw new HttpError(
      404,
      "EDGE_NOT_FOUND",
      `No edge ${from} → ${to} in this workflow — nothing to disconnect.`,
    );
  }
  await reconcileAttachments(workflowId, scope);
}

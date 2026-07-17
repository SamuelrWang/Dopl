import "server-only";

import { supabaseAdmin } from "@/shared/supabase/admin";
import { HttpError } from "@/shared/lib/http-error";
import {
  assertNotHeaderSentinel,
  buildAdjacency,
  reaches,
  reconcileAttachments,
} from "./authoring-shared";
import { findStep, getStep, listEdges, insertEdge, deleteEdge } from "./repository";
import type { WorkflowScope } from "./service";

/**
 * Per-edge authoring ops: connect two steps (with a self-edge + cycle
 * guard, and an optional branch `condition`) and disconnect an edge. Step
 * ops are in `authoring-nodes`; graph-level reconciliation is in
 * `authoring-graph`. Because a step belongs to exactly one workflow
 * (`workflow_steps.workflow_id`) and endpoints are resolved scoped to THIS
 * workflow, a step from another workflow simply won't resolve — the old
 * cross-workflow "dual-homing" guard is now structural.
 */

export async function connect(
  workflowId: string,
  from: string,
  to: string,
  condition: string,
  scope: WorkflowScope
): Promise<void> {
  assertNotHeaderSentinel([from, to]);
  const db = supabaseAdmin();

  const fromStep = await findStep(db, scope.workspaceId, workflowId, from);
  if (!fromStep) throw new HttpError(404, "STEP_NOT_FOUND", `Step not found in this workflow: ${from}`);
  const toStep = await findStep(db, scope.workspaceId, workflowId, to);
  if (!toStep) throw new HttpError(404, "STEP_NOT_FOUND", `Step not found in this workflow: ${to}`);
  if (fromStep.id === toStep.id) throw new HttpError(400, "SELF_EDGE", "Cannot connect a step to itself.");

  // Reject a back-edge: adding from→to closes a cycle iff `to` already
  // reaches `from`. Keeps the workflow a DAG (op='get' assumes it).
  const edges = await listEdges(db, scope.workspaceId, workflowId);
  const adj = buildAdjacency(edges.map((e) => ({ from: e.fromStepId, to: e.toStepId })));
  if (reaches(adj, toStep.id, fromStep.id)) {
    // Name the steps by their human titles (fall back to ref, then the raw
    // token) so the error reads to a person, not "<uuid> → <uuid>".
    const [fromFull, toFull] = await Promise.all([
      getStep(db, scope.workspaceId, workflowId, fromStep.id),
      getStep(db, scope.workspaceId, workflowId, toStep.id),
    ]);
    const label = (
      full: { title: string; ref: string } | null,
      fallbackRef: string,
      token: string,
    ) => full?.title?.trim() || full?.ref || fallbackRef || token;
    throw new HttpError(
      400,
      "WORKFLOW_CYCLE",
      `Connecting "${label(fromFull, fromStep.ref, from)}" → "${label(toFull, toStep.ref, to)}" would form a cycle. A workflow must stay acyclic.`,
    );
  }

  await insertEdge(db, scope.workspaceId, workflowId, fromStep.id, toStep.id, condition ?? "");
  await reconcileAttachments(workflowId, scope);
}

export async function disconnect(
  workflowId: string,
  from: string,
  to: string,
  scope: WorkflowScope
): Promise<void> {
  assertNotHeaderSentinel([from, to]);
  const db = supabaseAdmin();

  const fromStep = await findStep(db, scope.workspaceId, workflowId, from);
  const toStep = await findStep(db, scope.workspaceId, workflowId, to);
  const deleted =
    fromStep && toStep
      ? await deleteEdge(db, scope.workspaceId, workflowId, fromStep.id, toStep.id)
      : 0;
  if (deleted === 0) {
    throw new HttpError(
      404,
      "EDGE_NOT_FOUND",
      `No edge ${from} → ${to} in this workflow — nothing to disconnect.`,
    );
  }
  await reconcileAttachments(workflowId, scope);
}

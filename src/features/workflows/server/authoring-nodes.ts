import "server-only";

import { supabaseAdmin } from "@/shared/supabase/admin";
import { HttpError } from "@/shared/lib/http-error";
import { validateKbsForWorkflow } from "./attachments";
import {
  nodeDataFrom,
  kbIdsOf,
  type ActionRefInput,
  type NodeInput,
  type ReadRefInput,
  type ResolvedNodeData,
} from "./authoring-refs";
import { assertNotHeaderSentinel, reconcileAttachments } from "./authoring-shared";
import {
  countSteps,
  findStep,
  getStep,
  insertStep,
  updateStep,
  deleteStep,
  insertEdge,
  type StepWrite,
} from "./repository";
import type { WorkflowScope } from "./service";

/**
 * Per-step authoring ops: add a step (optionally wired in from another
 * step), update a step's content/refs in place, and remove a step.
 * Graph-level reconciliation is in `authoring-graph`; edge ops are in
 * `authoring-edges`.
 */

function stepWriteFrom(
  ref: string,
  title: string,
  data: ResolvedNodeData,
  position: number
): StepWrite {
  return {
    ref,
    title,
    description: data.description,
    reads: data.reads,
    actions: data.actions,
    userInput: data.userInput,
    agentOutput: data.agentOutput,
    nextInstructions: data.nextInstructions,
    position,
  };
}

/** Create one step and (optionally) connect it in from `connectFrom` (a
 *  step ref or id). With no `connectFrom` the step is an entry (indegree 0).
 *  Returns the new step's uuid. */
export async function addNode(
  workflowId: string,
  input: NodeInput,
  connectFrom: string | undefined,
  scope: WorkflowScope
): Promise<string> {
  assertNotHeaderSentinel([connectFrom]);
  const db = supabaseAdmin();

  // A step's ref is unique per workflow — reject a collision up front with a
  // clear message instead of a raw 23505.
  if (await findStep(db, scope.workspaceId, workflowId, input.ref)) {
    throw new HttpError(400, "DUPLICATE_REF", `A step with ref "${input.ref}" already exists in this workflow.`);
  }

  const { title, data } = await nodeDataFrom(input, scope);
  await validateKbsForWorkflow(workflowId, kbIdsOf([data]), scope);

  // F-5 — validate `connect_from` BEFORE inserting the step. Previously the
  // step was inserted first and the edge source resolved AFTER; a bad
  // `connect_from` threw STEP_NOT_FOUND but left the step committed as an
  // orphan. Resolving it up front (like the reads/actions refs already are)
  // makes a bad ref create NOTHING and return the clear error.
  let fromStepId: string | null = null;
  if (connectFrom) {
    const from = await findStep(db, scope.workspaceId, workflowId, connectFrom);
    if (!from) {
      throw new HttpError(404, "STEP_NOT_FOUND", `connect_from step not found in this workflow: ${connectFrom}`);
    }
    fromStepId = from.id;
  }

  const position = await countSteps(db, scope.workspaceId, workflowId);
  const stepId = await insertStep(
    db,
    scope.workspaceId,
    workflowId,
    stepWriteFrom(input.ref, title, data, position)
  );

  // `fromStepId` is a pre-existing step, so it can never equal the just-
  // inserted `stepId` (no self-edge possible here).
  if (fromStepId) {
    await insertEdge(db, scope.workspaceId, workflowId, fromStepId, stepId, "");
  }

  await reconcileAttachments(workflowId, scope);
  return stepId;
}

export async function updateNode(
  workflowId: string,
  nodeId: string,
  input: Partial<NodeInput>,
  scope: WorkflowScope
): Promise<void> {
  const db = supabaseAdmin();
  const cur = await getStep(db, scope.workspaceId, workflowId, nodeId);
  if (!cur) throw new HttpError(404, "NODE_NOT_FOUND", `Step not found: ${nodeId}`);

  const merged: NodeInput = {
    ref: cur.ref,
    title: input.title ?? cur.title,
    description: input.description ?? cur.description,
    reads: input.reads,
    actions: input.actions,
    userInput: input.userInput ?? cur.userInput,
    agentOutput: input.agentOutput ?? cur.agentOutput,
    nextInstructions: input.nextInstructions ?? cur.nextInstructions,
  };

  // Only re-resolve refs if the caller supplied them; else keep current.
  let title: string;
  let data: ResolvedNodeData;
  if (input.reads === undefined && input.actions === undefined) {
    title = merged.title ?? "";
    data = {
      description: merged.description ?? "",
      reads: cur.reads,
      actions: cur.actions,
      userInput: merged.userInput ?? "",
      agentOutput: merged.agentOutput ?? "",
      nextInstructions: merged.nextInstructions ?? "",
      ref: cur.ref,
    };
  } else {
    const built = await nodeDataFrom(
      {
        ...merged,
        reads: (input.reads ?? cur.reads.map(readToInput)) as ReadRefInput[],
        actions: (input.actions ?? cur.actions.map(actionToInput)) as ActionRefInput[],
      },
      scope
    );
    title = built.title;
    data = built.data;
  }

  await validateKbsForWorkflow(workflowId, kbIdsOf([data]), scope);
  await updateStep(
    db,
    scope.workspaceId,
    workflowId,
    cur.id,
    stepWriteFrom(cur.ref, title, data, cur.position)
  );
  await reconcileAttachments(workflowId, scope);
}

export async function removeNode(
  workflowId: string,
  nodeId: string,
  scope: WorkflowScope
): Promise<void> {
  const db = supabaseAdmin();
  const step = await findStep(db, scope.workspaceId, workflowId, nodeId);
  if (!step) throw new HttpError(404, "NODE_NOT_FOUND", `Step not found: ${nodeId}`);
  // workflow_step_edges FK is ON DELETE CASCADE, so its edges go with it.
  await deleteStep(db, scope.workspaceId, workflowId, step.id);
  await reconcileAttachments(workflowId, scope);
}

/** Turn a stored read back into the wire ref-input shape (kbId/entryId) so a
 *  partial update that only changes text keeps the existing reads. */
function readToInput(r: { kbId: string; entryId?: string }): ReadRefInput {
  return r.entryId ? { kbId: r.kbId, entryId: r.entryId } : { kbId: r.kbId };
}

function actionToInput(a: { skillId: string }): ActionRefInput {
  return { skillId: a.skillId };
}

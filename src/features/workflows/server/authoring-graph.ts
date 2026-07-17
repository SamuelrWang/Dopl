import "server-only";

import { supabaseAdmin } from "@/shared/supabase/admin";
import { HttpError } from "@/shared/lib/http-error";
import { validateKbsForWorkflow } from "./attachments";
import {
  nodeDataFrom,
  kbIdsOf,
  type GraphSpec,
  type ResolvedNodeData,
} from "./authoring-refs";
import {
  assertNotHeaderSentinel,
  buildAdjacency,
  graphHasCycle,
  reconcileAttachments,
} from "./authoring-shared";
import {
  listSteps,
  listEdges,
  insertStep,
  updateStep,
  deleteStep,
  insertEdge,
  deleteEdge,
  type StepWrite,
} from "./repository";
import type { WorkflowScope } from "./service";

/**
 * Graph-level authoring: the declarative `setGraph` op that reconciles a
 * workflow's whole step/edge graph to match a spec exactly, diffing
 * existing steps by their stable `ref`. Per-step and per-edge ops live in
 * `authoring-nodes` / `authoring-edges`.
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

/** Declarative: make the workflow's graph match `spec` exactly. */
export async function setGraph(
  workflowId: string,
  spec: GraphSpec,
  scope: WorkflowScope
): Promise<void> {
  const db = supabaseAdmin();

  // The retired "header" endpoint is no longer a valid edge target.
  assertNotHeaderSentinel(spec.edges.flatMap((e) => [e.from, e.to]));

  // Refs are the reconciliation key + edge endpoints — duplicates would
  // strand an unconnected orphan step (the second wins the ref→id map).
  const refSet = new Set<string>();
  for (const n of spec.nodes) {
    if (refSet.has(n.ref)) {
      throw new HttpError(400, "DUPLICATE_REF", `Duplicate step ref "${n.ref}" — each step needs a unique ref.`);
    }
    refSet.add(n.ref);
  }

  // Validate edges UPFRONT (no partial graph). Rather than silently dropping
  // malformed edges — which hides a real authoring mistake — reject them with
  // a message naming the offender. A pair repeated with the SAME condition is
  // a harmless duplicate (deduped below); repeated with a DIFFERENT condition
  // is a genuine conflict the author must resolve.
  const conditionByPair = new Map<string, string>();
  for (const e of spec.edges) {
    if (!refSet.has(e.from)) {
      throw new HttpError(400, "INVALID_EDGE", `Edge references unknown step ref "${e.from}" — every edge endpoint must be a declared node ref.`);
    }
    if (!refSet.has(e.to)) {
      throw new HttpError(400, "INVALID_EDGE", `Edge references unknown step ref "${e.to}" — every edge endpoint must be a declared node ref.`);
    }
    if (e.from === e.to) {
      throw new HttpError(400, "INVALID_EDGE", `Edge connects step "${e.from}" to itself — self-edges aren't allowed.`);
    }
    const pair = `${e.from}->${e.to}`;
    const cond = e.condition ?? "";
    const prior = conditionByPair.get(pair);
    if (prior !== undefined && prior !== cond) {
      throw new HttpError(400, "DUPLICATE_EDGE", `Duplicate edge "${e.from}" → "${e.to}" with conflicting conditions — keep a single edge per step pair.`);
    }
    conditionByPair.set(pair, cond);
  }

  // Resolve + validate every step's refs UPFRONT so an invalid ref aborts
  // before any write (no partial graph).
  const resolved = await Promise.all(spec.nodes.map((n) => nodeDataFrom(n, scope)));

  // Team invariant: the workflow's audience must be able to read every
  // referenced KB — abort before any write.
  await validateKbsForWorkflow(workflowId, kbIdsOf(resolved.map((r) => r.data)), scope);

  // Reject cycles BEFORE any write (keeps set_graph atomic). A workflow is
  // a DAG; a back-edge yields a self-contradictory plan when op='get'
  // topologically orders the steps. Endpoints are already validated above.
  if (graphHasCycle(buildAdjacency(spec.edges))) {
    throw new HttpError(
      400,
      "WORKFLOW_CYCLE",
      "These edges form a cycle. A workflow must be acyclic (steps run in topological order) — remove the back-edge.",
    );
  }

  // Map existing steps by their stored ref.
  const existing = await listSteps(db, scope.workspaceId, workflowId);
  const idByRef = new Map(existing.map((s) => [s.ref, s.id]));

  // Upsert steps in spec order; position = index (stable topo tie-break).
  const refToId = new Map<string, string>();
  for (let i = 0; i < spec.nodes.length; i++) {
    const ref = spec.nodes[i].ref;
    const write = stepWriteFrom(ref, resolved[i].title, resolved[i].data, i);
    const existingId = idByRef.get(ref);
    if (existingId) {
      await updateStep(db, scope.workspaceId, workflowId, existingId, write);
      refToId.set(ref, existingId);
    } else {
      const id = await insertStep(db, scope.workspaceId, workflowId, write);
      refToId.set(ref, id);
    }
  }

  // Delete steps no longer in the spec (their edges cascade via FK).
  for (const s of existing) {
    if (!refSet.has(s.ref)) {
      await deleteStep(db, scope.workspaceId, workflowId, s.id);
    }
  }

  // Reconcile edges to exactly the spec (resolve node refs → step ids).
  const wantedEdges: Array<{ from: string; to: string; condition: string }> = [];
  const wantedKeys = new Set<string>();
  for (const e of spec.edges) {
    const from = refToId.get(e.from);
    const to = refToId.get(e.to);
    if (!from || !to || from === to) continue;
    const key = `${from}->${to}`;
    if (wantedKeys.has(key)) continue;
    wantedKeys.add(key);
    wantedEdges.push({ from, to, condition: e.condition ?? "" });
  }
  const curEdges = await listEdges(db, scope.workspaceId, workflowId);
  // Upsert wanted edges (also updates the condition on an existing pair).
  for (const w of wantedEdges) {
    await insertEdge(db, scope.workspaceId, workflowId, w.from, w.to, w.condition);
  }
  // Remove edges not in the spec.
  for (const e of curEdges) {
    if (!wantedKeys.has(`${e.fromStepId}->${e.toStepId}`)) {
      await deleteEdge(db, scope.workspaceId, workflowId, e.fromStepId, e.toStepId);
    }
  }

  await reconcileAttachments(workflowId, scope);
}

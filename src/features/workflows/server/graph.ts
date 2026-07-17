import "server-only";

import { supabaseAdmin } from "@/shared/supabase/admin";
import type { WorkflowStep } from "../types";
import { listSteps, listEdges } from "./repository";

/**
 * Compose a workflow's graph from the first-class step tables:
 * `workflow_steps` are the steps and `workflow_step_edges` are the
 * connectors (each carrying a branch `condition`). Steps are
 * topologically ordered when the edge graph is acyclic (Kahn); on a cycle
 * it falls back to `position` order (the order `listSteps` returns).
 *
 * There is no header concept: entry steps are those with no incoming edge
 * (indegree 0). Returns an empty graph ({ nodes: [], edges: [] }) for a
 * workflow with no steps.
 */

/** Composed graph response. `nodes` are topo-ordered steps; edge endpoints
 *  are step ids and carry the branch condition. Shape mirrors the previous
 *  canvas-derived WorkflowGraph, with `condition` added to edges and `ref`
 *  present on each step. */
export interface WorkflowGraph {
  nodes: WorkflowStep[];
  edges: Array<{ from: string; to: string; condition: string }>;
}

export async function composeWorkflow(
  workspaceId: string,
  workflowId: string
): Promise<WorkflowGraph> {
  const db = supabaseAdmin();
  const [steps, edges] = await Promise.all([
    listSteps(db, workspaceId, workflowId),
    listEdges(db, workspaceId, workflowId),
  ]);
  if (steps.length === 0) return { nodes: [], edges: [] };

  const pairs = edges.map((e) => ({ from: e.fromStepId, to: e.toStepId }));
  return {
    nodes: topoSort(steps, pairs),
    edges: edges.map((e) => ({
      from: e.fromStepId,
      to: e.toStepId,
      condition: e.condition,
    })),
  };
}

/** Kahn topological order; falls back to input order on a cycle. Input
 *  order is `position` (stable tie-break) so parallel branches emit in a
 *  deterministic sequence. */
export function topoSort(
  nodes: WorkflowStep[],
  edges: Array<{ from: string; to: string }>
): WorkflowStep[] {
  const indegree = new Map<string, number>(nodes.map((n) => [n.id, 0]));
  const out = new Map<string, string[]>();
  for (const e of edges) {
    if (!indegree.has(e.from) || !indegree.has(e.to)) continue;
    indegree.set(e.to, (indegree.get(e.to) ?? 0) + 1);
    out.set(e.from, [...(out.get(e.from) ?? []), e.to]);
  }
  const queue = nodes.filter((n) => (indegree.get(n.id) ?? 0) === 0);
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const sorted: WorkflowStep[] = [];
  while (queue.length > 0) {
    const n = queue.shift()!;
    sorted.push(n);
    for (const next of out.get(n.id) ?? []) {
      const d = (indegree.get(next) ?? 1) - 1;
      indegree.set(next, d);
      if (d === 0) {
        const node = byId.get(next);
        if (node) queue.push(node);
      }
    }
  }
  return sorted.length === nodes.length ? sorted : nodes;
}

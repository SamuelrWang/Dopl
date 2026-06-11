import "server-only";

import { supabaseAdmin } from "@/shared/supabase/admin";

/**
 * Compose a workflow's graph from the canvas:
 *   the workflow's header panel (panel_type 'workflow', panel_data.workflowId)
 *   anchors it; every `node` panel reachable from the header through
 *   `canvas_edges` (in either direction) is a step, and the edges between
 *   those nodes are the connectors.
 *
 * Nodes are topologically ordered when the edge graph is acyclic (Kahn);
 * on a cycle, falls back to spatial (top→bottom, left→right) order. Returns
 * null when no header panel exists for the workflow; an empty node list when
 * the header has no connected nodes yet.
 */

export interface WorkflowNode {
  /** Canvas panel id (`panel-N`) — referenced by edges. */
  id: string;
  title: string;
  description: string;
  reads: Array<{
    kind: "kb" | "file";
    kbId: string;
    entryId?: string;
    name: string;
  }>;
  actions: Array<{ kind: "skill"; skillId: string; name: string }>;
  userInput: string;
  agentOutput: string;
  nextInstructions: string;
}

export interface WorkflowGraph {
  nodes: WorkflowNode[];
  edges: Array<{ from: string; to: string }>;
}

export async function composeWorkflow(
  workspaceId: string,
  workflowId: string
): Promise<WorkflowGraph | null> {
  const db = supabaseAdmin();

  const { data: headerRows } = await db
    .from("canvas_panels")
    .select("panel_id, panel_data")
    .eq("workspace_id", workspaceId)
    .eq("panel_type", "workflow");
  const header = (headerRows ?? []).find(
    (r) => (r.panel_data as { workflowId?: string } | null)?.workflowId === workflowId
  );
  if (!header) return null;

  const [{ data: nodeRows }, { data: edgeRows }] = await Promise.all([
    db
      .from("canvas_panels")
      .select("panel_id, title, panel_data, x, y")
      .eq("workspace_id", workspaceId)
      .eq("panel_type", "node"),
    db
      .from("canvas_edges")
      .select("from_panel_id, to_panel_id")
      .eq("workspace_id", workspaceId)
      // Deterministic edge order → deterministic Kahn tie-breaking.
      .order("from_panel_id")
      .order("to_panel_id"),
  ]);

  const allEdges = (edgeRows ?? []).map((r) => ({
    from: r.from_panel_id as string,
    to: r.to_panel_id as string,
  }));
  const nodeById = new Map(
    (nodeRows ?? []).map((r) => [r.panel_id as string, r])
  );

  // Undirected reachability from the header → workflow membership.
  const adj = new Map<string, string[]>();
  for (const e of allEdges) {
    adj.set(e.from, [...(adj.get(e.from) ?? []), e.to]);
    adj.set(e.to, [...(adj.get(e.to) ?? []), e.from]);
  }
  const headerId = header.panel_id as string;
  // Other workflows' header panels are membership BOUNDARIES: reachability
  // never expands through them, so two workflows that share a connecting
  // panel (or are wired header-to-header) don't merge into one another.
  const otherHeaderIds = new Set(
    (headerRows ?? [])
      .map((r) => r.panel_id as string)
      .filter((id) => id !== headerId)
  );
  const visited = new Set<string>([headerId]);
  const queue: string[] = [headerId];
  while (queue.length > 0) {
    const cur = queue.shift()!;
    for (const nb of adj.get(cur) ?? []) {
      if (visited.has(nb)) continue;
      visited.add(nb);
      if (otherHeaderIds.has(nb)) continue; // boundary — don't expand through
      queue.push(nb);
    }
  }

  const memberIds = [...visited].filter((id) => nodeById.has(id));
  if (memberIds.length === 0) return { nodes: [], edges: [] };
  const memberSet = new Set(memberIds);

  const memberRows = memberIds.map((id) => nodeById.get(id)!);
  memberRows.sort(
    (a, b) =>
      (a.y as number) - (b.y as number) || (a.x as number) - (b.x as number)
  );

  const nodes: WorkflowNode[] = memberRows.map((row) => {
    const d = (row.panel_data ?? {}) as Record<string, unknown>;
    return {
      id: row.panel_id as string,
      title: (row.title as string) || "",
      description: (d.description as string) || "",
      reads: Array.isArray(d.reads)
        ? (d.reads as WorkflowNode["reads"])
        : [],
      actions: Array.isArray(d.actions)
        ? (d.actions as WorkflowNode["actions"])
        : [],
      userInput: (d.userInput as string) || "",
      agentOutput: (d.agentOutput as string) || "",
      nextInstructions: (d.nextInstructions as string) || "",
    };
  });

  const edges = allEdges.filter(
    (e) => memberSet.has(e.from) && memberSet.has(e.to)
  );
  return { nodes: topoSort(nodes, edges), edges };
}

/** Kahn topological order; falls back to input order on a cycle. */
function topoSort(
  nodes: WorkflowNode[],
  edges: Array<{ from: string; to: string }>
): WorkflowNode[] {
  const indegree = new Map<string, number>(nodes.map((n) => [n.id, 0]));
  const out = new Map<string, string[]>();
  for (const e of edges) {
    indegree.set(e.to, (indegree.get(e.to) ?? 0) + 1);
    out.set(e.from, [...(out.get(e.from) ?? []), e.to]);
  }
  const queue = nodes.filter((n) => (indegree.get(n.id) ?? 0) === 0);
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const sorted: WorkflowNode[] = [];
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

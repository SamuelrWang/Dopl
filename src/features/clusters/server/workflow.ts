import "server-only";

import { supabaseAdmin } from "@/shared/supabase/admin";

/**
 * Compose a cluster's WORKFLOW definition from the canvas:
 *   canvas_state.clusters (workspace-scoped jsonb) carries each store
 *   cluster's panelIds + dbId → member canvas_panels of panel_type
 *   'node' are the workflow steps → canvas_edges between them are the
 *   connectors.
 *
 * Returned nodes are topologically ordered when the edge graph is
 * acyclic (Kahn's algorithm); on a cycle, falls back to canvas order.
 * Returns null when the cluster has no node panels — callers render
 * the legacy attachments-only view.
 */

export interface ClusterWorkflowNode {
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

export interface ClusterWorkflow {
  nodes: ClusterWorkflowNode[];
  edges: Array<{ from: string; to: string }>;
}

interface StateClusterEntry {
  dbId?: string;
  panelIds?: string[];
}

export async function composeClusterWorkflow(
  workspaceId: string,
  clusterDbId: string
): Promise<ClusterWorkflow | null> {
  const db = supabaseAdmin();

  const { data: stateRow } = await db
    .from("canvas_state")
    .select("clusters")
    .eq("workspace_id", workspaceId)
    .maybeSingle();
  const stateClusters = (stateRow?.clusters ?? []) as StateClusterEntry[];
  const entry = stateClusters.find((c) => c.dbId === clusterDbId);
  const panelIds = entry?.panelIds ?? [];
  if (panelIds.length === 0) return null;

  const { data: panelRows } = await db
    .from("canvas_panels")
    .select("panel_id, panel_type, title, panel_data, x, y")
    .eq("workspace_id", workspaceId)
    .in("panel_id", panelIds)
    .eq("panel_type", "node");
  if (!panelRows || panelRows.length === 0) return null;

  // Stable spatial order (top-to-bottom, left-to-right) as the
  // pre-topological baseline.
  panelRows.sort(
    (a, b) => (a.y as number) - (b.y as number) || (a.x as number) - (b.x as number)
  );

  const nodes: ClusterWorkflowNode[] = panelRows.map((row) => {
    const data = (row.panel_data ?? {}) as Record<string, unknown>;
    return {
      id: row.panel_id as string,
      title: (row.title as string) || "",
      description: (data.description as string) || "",
      reads: Array.isArray(data.reads)
        ? (data.reads as ClusterWorkflowNode["reads"])
        : [],
      actions: Array.isArray(data.actions)
        ? (data.actions as ClusterWorkflowNode["actions"])
        : [],
      userInput: (data.userInput as string) || "",
      agentOutput: (data.agentOutput as string) || "",
      nextInstructions: (data.nextInstructions as string) || "",
    };
  });

  const nodeIds = new Set(nodes.map((n) => n.id));
  let edges: Array<{ from: string; to: string }> = [];
  try {
    const { data: edgeRows } = await db
      .from("canvas_edges")
      .select("from_panel_id, to_panel_id")
      .eq("workspace_id", workspaceId);
    edges = (edgeRows ?? [])
      .map((r) => ({
        from: r.from_panel_id as string,
        to: r.to_panel_id as string,
      }))
      .filter((e) => nodeIds.has(e.from) && nodeIds.has(e.to));
  } catch {
    // canvas_edges table missing (migration pending) — workflow still
    // returns nodes, just unconnected.
  }

  return { nodes: topoSort(nodes, edges), edges };
}

/** Kahn topological order; falls back to input order on a cycle. */
function topoSort(
  nodes: ClusterWorkflowNode[],
  edges: Array<{ from: string; to: string }>
): ClusterWorkflowNode[] {
  const indegree = new Map<string, number>(nodes.map((n) => [n.id, 0]));
  const out = new Map<string, string[]>();
  for (const e of edges) {
    indegree.set(e.to, (indegree.get(e.to) ?? 0) + 1);
    out.set(e.from, [...(out.get(e.from) ?? []), e.to]);
  }
  // Queue seeded in input (spatial) order for deterministic output.
  const queue = nodes.filter((n) => (indegree.get(n.id) ?? 0) === 0);
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const sorted: ClusterWorkflowNode[] = [];
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

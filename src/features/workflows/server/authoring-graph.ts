import "server-only";

import { supabaseAdmin } from "@/shared/supabase/admin";
import { HttpError } from "@/shared/lib/http-error";
import { NODE_PANEL_SIZE, WORKFLOW_PANEL_SIZE } from "@/features/canvas/types";
import { insertEdge } from "@/features/canvas/server/edges";
import { validateKbsForWorkflow } from "./attachments";
import { resolveHeaderPanelId, shortId } from "./authoring-header";
import { nodeDataFrom, kbIdsOf, type GraphSpec } from "./authoring-refs";
import {
  NODE_GAP,
  buildAdjacency,
  deleteEdgeByPair,
  graphHasCycle,
  memberNodePanels,
  reconcileAttachments,
  writeNodePanel,
} from "./authoring-shared";
import type { WorkflowScope } from "./service";

/**
 * Graph-level authoring: the declarative `setGraph` op that reconciles a
 * workflow's whole node/edge graph to match a spec exactly (diffing
 * existing panels by their stored ref). Per-node and per-edge ops live in
 * `authoring-nodes` / `authoring-edges`.
 */

/** Declarative: make the workflow's graph match `spec` exactly. */
export async function setGraph(
  workflowId: string,
  spec: GraphSpec,
  scope: WorkflowScope
): Promise<void> {
  const db = supabaseAdmin();
  const headerId = await resolveHeaderPanelId(workflowId, scope);

  // Refs are the reconciliation key + edge endpoints — duplicates would
  // strand an unconnected orphan node (the second wins the ref→id map).
  const seenRefs = new Set<string>();
  for (const n of spec.nodes) {
    if (seenRefs.has(n.ref)) {
      throw new HttpError(400, "DUPLICATE_REF", `Duplicate node ref "${n.ref}" — each node needs a unique ref.`);
    }
    seenRefs.add(n.ref);
  }

  // Resolve + validate every node's refs UPFRONT so an invalid ref aborts
  // before any write (no partial graph).
  const resolved = await Promise.all(spec.nodes.map((n) => nodeDataFrom(n, scope)));

  // Team invariant: the workflow's audience must be able to read every
  // referenced KB — abort before any panel write.
  await validateKbsForWorkflow(workflowId, kbIdsOf(resolved.map((r) => r.data)), scope);

  // Reject cycles BEFORE any write (keeps set_graph atomic). A workflow is
  // a DAG; a back-edge yields a self-contradictory plan when op='get'
  // topologically orders the steps. Only consider edges whose endpoints are
  // valid (header or a declared ref) — unknown refs are dropped anyway.
  {
    const refSet = new Set(spec.nodes.map((n) => n.ref));
    const valid = (t: string) => t === "header" || refSet.has(t);
    const intended = spec.edges.filter((e) => valid(e.from) && valid(e.to));
    if (graphHasCycle(buildAdjacency(intended))) {
      throw new HttpError(
        400,
        "WORKFLOW_CYCLE",
        "These edges form a cycle. A workflow must be acyclic (steps run in topological order) — remove the back-edge.",
      );
    }
  }

  // Map existing member nodes by their stored ref.
  const { panels: existing } = await memberNodePanels(workflowId, scope);
  const idByRef = new Map<string, string>();
  for (const p of existing) {
    const ref = (p.panel_data as { ref?: string } | null)?.ref;
    if (ref) idByRef.set(ref, p.panel_id as string);
  }

  // Header position anchors the column.
  const { data: headerRow } = await db
    .from("canvas_panels").select("x, y").eq("workspace_id", scope.workspaceId).eq("panel_id", headerId).single();
  const baseX = (headerRow?.x as number) ?? 0;
  const baseY = ((headerRow?.y as number) ?? 0) + WORKFLOW_PANEL_SIZE.height + 160;

  // Upsert nodes in spec order; assign panel ids + a left→right column.
  const refToPanelId = new Map<string, string>();
  for (let i = 0; i < spec.nodes.length; i++) {
    const ref = spec.nodes[i].ref;
    const panelId = idByRef.get(ref) ?? shortId("n");
    refToPanelId.set(ref, panelId);
    const x = baseX + i * (NODE_PANEL_SIZE.width + NODE_GAP);
    await writeNodePanel(panelId, resolved[i].title, resolved[i].data, x, baseY, scope);
  }

  // Delete member nodes no longer in the spec.
  const keepIds = new Set(refToPanelId.values());
  for (const p of existing) {
    if (!keepIds.has(p.panel_id as string)) {
      await db.from("canvas_panels").delete().eq("workspace_id", scope.workspaceId).eq("panel_id", p.panel_id as string);
    }
  }

  const resolveEnd = (token: string): string | null => {
    if (token === "header") return headerId;
    return refToPanelId.get(token) ?? null;
  };

  // Set edges to exactly the spec (resolve header + node refs).
  const { data: curEdges } = await db
    .from("canvas_edges").select("id, from_panel_id, to_panel_id").eq("workspace_id", scope.workspaceId);
  const memberPanelIds = new Set<string>([headerId, ...refToPanelId.values()]);
  const wantPairs = new Set<string>();
  for (const e of spec.edges) {
    const from = resolveEnd(e.from);
    const to = resolveEnd(e.to);
    if (!from || !to || from === to) continue;
    wantPairs.add(`${from}->${to}`);
    await insertEdge(scope.workspaceId, scope.userId, { id: crypto.randomUUID(), fromPanelId: from, toPanelId: to });
  }
  // Remove edges among this workflow's panels that aren't wanted.
  for (const e of curEdges ?? []) {
    if (!memberPanelIds.has(e.from_panel_id) && !memberPanelIds.has(e.to_panel_id)) continue;
    if (!wantPairs.has(`${e.from_panel_id}->${e.to_panel_id}`)) {
      await deleteEdgeByPair(scope.workspaceId, e.from_panel_id, e.to_panel_id);
    }
  }

  await reconcileAttachments(workflowId, scope);
}

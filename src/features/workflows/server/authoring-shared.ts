import "server-only";

import { supabaseAdmin } from "@/shared/supabase/admin";
import { HttpError } from "@/shared/lib/http-error";
import { NODE_PANEL_SIZE } from "@/features/canvas/types";
import { composeWorkflow } from "./graph";
import { validateKbsForWorkflow } from "./attachments";
import { resolveHeaderPanelId } from "./authoring-header";
import type { ResolvedNodeData } from "./authoring-refs";
import type { WorkflowScope } from "./service";

/**
 * Cross-cutting internals shared by the graph / node / edge authoring
 * ops: node ↔ workflow ownership resolution, node/edge panel primitives,
 * cycle detection, and attachment reconciliation. Ops-specific logic
 * lives in `authoring-graph`, `authoring-nodes`, and `authoring-edges`.
 */

// ── Ownership ────────────────────────────────────────────────────────

/**
 * Map every node panel_id → the set of workflow ids whose header reaches it
 * (undirected, stopping at other headers — mirrors graph.ts). Used to keep
 * authoring ops from touching a node that belongs to a DIFFERENT workflow.
 */
export async function nodeOwnership(
  scope: WorkflowScope
): Promise<Map<string, Set<string>>> {
  const db = supabaseAdmin();
  const [{ data: panels }, { data: edges }] = await Promise.all([
    db
      .from("canvas_panels")
      .select("panel_id, panel_type, panel_data")
      .eq("workspace_id", scope.workspaceId)
      .in("panel_type", ["workflow", "node"]),
    db
      .from("canvas_edges")
      .select("from_panel_id, to_panel_id")
      .eq("workspace_id", scope.workspaceId),
  ]);

  const adj = new Map<string, string[]>();
  for (const e of edges ?? []) {
    adj.set(e.from_panel_id, [...(adj.get(e.from_panel_id) ?? []), e.to_panel_id]);
    adj.set(e.to_panel_id, [...(adj.get(e.to_panel_id) ?? []), e.from_panel_id]);
  }
  const headers = (panels ?? []).filter((p) => p.panel_type === "workflow");
  const headerIds = new Set(headers.map((h) => h.panel_id));
  const nodeIds = new Set(
    (panels ?? []).filter((p) => p.panel_type === "node").map((p) => p.panel_id)
  );

  const out = new Map<string, Set<string>>();
  for (const h of headers) {
    const wfId = (h.panel_data as { workflowId?: string } | null)?.workflowId;
    if (!wfId) continue;
    const visited = new Set<string>([h.panel_id]);
    const queue = [h.panel_id];
    while (queue.length) {
      const cur = queue.shift()!;
      for (const nb of adj.get(cur) ?? []) {
        if (visited.has(nb)) continue;
        visited.add(nb);
        if (headerIds.has(nb) && nb !== h.panel_id) continue;
        queue.push(nb);
      }
    }
    for (const id of visited) {
      if (!nodeIds.has(id)) continue;
      const set = out.get(id) ?? new Set<string>();
      set.add(wfId);
      out.set(id, set);
    }
  }
  return out;
}

/** Guard: the node must be edge-reachable from THIS workflow's header. */
export async function assertNodeInWorkflow(
  workflowId: string,
  nodeId: string,
  scope: WorkflowScope
): Promise<void> {
  const own = await nodeOwnership(scope);
  if (!own.get(nodeId)?.has(workflowId)) {
    throw new HttpError(404, "NODE_NOT_IN_WORKFLOW", `Node ${nodeId} is not part of this workflow.`);
  }
}

// ── Node + edge primitives ───────────────────────────────────────────

export const NODE_GAP = 80;

export async function memberNodePanels(workflowId: string, scope: WorkflowScope) {
  const db = supabaseAdmin();
  const headerId = await resolveHeaderPanelId(workflowId, scope);
  const graph = await composeWorkflow(scope.workspaceId, workflowId);
  const ids = (graph?.nodes ?? []).map((n) => n.id);
  const { data } = await db
    .from("canvas_panels")
    .select("panel_id, x, y, panel_data")
    .eq("workspace_id", scope.workspaceId)
    .in("panel_id", ids.length ? ids : ["__none__"]);
  return { headerId, panels: data ?? [] };
}

export async function writeNodePanel(
  panelId: string,
  title: string,
  data: ResolvedNodeData,
  x: number,
  y: number,
  scope: WorkflowScope
): Promise<void> {
  const db = supabaseAdmin();
  const { error } = await db.from("canvas_panels").upsert(
    {
      workspace_id: scope.workspaceId,
      panel_id: panelId,
      user_id: scope.userId,
      panel_type: "node",
      x,
      y,
      width: NODE_PANEL_SIZE.width,
      height: NODE_PANEL_SIZE.height,
      title,
      panel_data: data as unknown as Record<string, unknown>,
    },
    { onConflict: "workspace_id,panel_id" }
  );
  if (error) throw error;
}

export async function deleteEdgeByPair(workspaceId: string, from: string, to: string): Promise<number> {
  const db = supabaseAdmin();
  // `.select()` returns the deleted rows so callers can distinguish a real
  // removal from a no-op. Reconcile (setGraph) ignores the count; `disconnect`
  // uses it to 404 instead of reporting a false success.
  const { data, error } = await db
    .from("canvas_edges")
    .delete()
    .eq("workspace_id", workspaceId)
    .eq("from_panel_id", from)
    .eq("to_panel_id", to)
    .select("id");
  if (error) throw error;
  return data?.length ?? 0;
}

// ── Cycle detection ──────────────────────────────────────────────────
// A workflow is a DAG — `dopl_workflow(op='get')` topologically orders the
// steps, so a back-edge produces a self-contradictory, unexecutable plan.
// Reject cycles at author time instead of letting them through.

export function buildAdjacency(
  edges: Array<{ from: string; to: string }>
): Map<string, string[]> {
  const adj = new Map<string, string[]>();
  for (const e of edges) {
    if (e.from === e.to) continue;
    const tos = adj.get(e.from);
    if (tos) tos.push(e.to);
    else adj.set(e.from, [e.to]);
  }
  return adj;
}

/** DFS three-colour cycle check over a directed graph. */
export function graphHasCycle(adj: Map<string, string[]>): boolean {
  const GRAY = 1;
  const BLACK = 2;
  const color = new Map<string, number>();
  const nodes = new Set<string>();
  for (const [from, tos] of adj) {
    nodes.add(from);
    for (const t of tos) nodes.add(t);
  }
  const visit = (u: string): boolean => {
    color.set(u, GRAY);
    for (const v of adj.get(u) ?? []) {
      const c = color.get(v);
      if (c === GRAY) return true;
      if (c === undefined && visit(v)) return true;
    }
    color.set(u, BLACK);
    return false;
  };
  for (const n of nodes) {
    if (color.get(n) === undefined && visit(n)) return true;
  }
  return false;
}

/** Can `start` reach `target` by following directed edges? Used by connect
 *  to detect that a new from→to edge would close a cycle (to already reaches
 *  from). Scoped to the given adjacency so unrelated graphs don't interfere. */
export function reaches(
  adj: Map<string, string[]>,
  start: string,
  target: string
): boolean {
  const seen = new Set<string>([start]);
  const stack = [start];
  while (stack.length) {
    const u = stack.pop()!;
    for (const v of adj.get(u) ?? []) {
      if (v === target) return true;
      if (!seen.has(v)) {
        seen.add(v);
        stack.push(v);
      }
    }
  }
  return false;
}

// ── Attachment reconciliation ────────────────────────────────────────

/** Sync workflow_knowledge_bases / workflow_skills to the union of KB/skill
 *  ids referenced by the workflow's (edge-reachable) nodes. */
export async function reconcileAttachments(
  workflowId: string,
  scope: WorkflowScope
): Promise<void> {
  const db = supabaseAdmin();
  const graph = await composeWorkflow(scope.workspaceId, workflowId);
  const wantKb = new Set<string>();
  const wantSkill = new Set<string>();
  for (const n of graph?.nodes ?? []) {
    for (const r of n.reads) if (r.kind === "kb" || r.kind === "file") wantKb.add(r.kbId);
    for (const a of n.actions) if (a.kind === "skill") wantSkill.add(a.skillId);
  }

  const [{ data: curKb }, { data: curSkill }] = await Promise.all([
    db.from("workflow_knowledge_bases").select("knowledge_base_id").eq("workflow_id", workflowId).eq("workspace_id", scope.workspaceId),
    db.from("workflow_skills").select("skill_id").eq("workflow_id", workflowId).eq("workspace_id", scope.workspaceId),
  ]);
  const haveKb = new Set((curKb ?? []).map((r) => r.knowledge_base_id));
  const haveSkill = new Set((curSkill ?? []).map((r) => r.skill_id));

  const kbInserts = [...wantKb].filter((id) => !haveKb.has(id)).map((id) => ({
    workflow_id: workflowId, knowledge_base_id: id, workspace_id: scope.workspaceId, added_by_user_id: scope.userId,
  }));
  const skillInserts = [...wantSkill].filter((id) => !haveSkill.has(id)).map((id) => ({
    workflow_id: workflowId, skill_id: id, workspace_id: scope.workspaceId, added_by_user_id: scope.userId,
  }));
  const kbDeletes = [...haveKb].filter((id) => !wantKb.has(id));
  const skillDeletes = [...haveSkill].filter((id) => !wantSkill.has(id));

  // Backstop for paths that don't pre-validate (connect/disconnect wiring
  // an existing node in, removeNode): newly attached KBs must be readable
  // by this workflow's whole audience — same 409 as the explicit attach.
  if (kbInserts.length) {
    await validateKbsForWorkflow(
      workflowId,
      kbInserts.map((i) => i.knowledge_base_id),
      scope
    );
  }
  if (kbInserts.length) await db.from("workflow_knowledge_bases").upsert(kbInserts, { onConflict: "workflow_id,knowledge_base_id" });
  if (skillInserts.length) await db.from("workflow_skills").upsert(skillInserts, { onConflict: "workflow_id,skill_id" });
  if (kbDeletes.length) await db.from("workflow_knowledge_bases").delete().eq("workflow_id", workflowId).in("knowledge_base_id", kbDeletes);
  if (skillDeletes.length) await db.from("workflow_skills").delete().eq("workflow_id", workflowId).in("skill_id", skillDeletes);
}

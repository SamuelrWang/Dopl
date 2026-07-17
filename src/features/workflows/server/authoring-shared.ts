import "server-only";

import { supabaseAdmin } from "@/shared/supabase/admin";
import { HttpError } from "@/shared/lib/http-error";
import { composeWorkflow } from "./graph";
import { validateKbsForWorkflow } from "./attachments";
import type { WorkflowScope } from "./service";

/**
 * Cross-cutting internals shared by the graph / node / edge authoring ops:
 * the retired-"header"-sentinel guard, cycle detection, and attachment
 * reconciliation. Op-specific logic lives in `authoring-graph`,
 * `authoring-nodes`, and `authoring-edges`.
 */

// ── Header sentinel guard ────────────────────────────────────────────
// The old canvas model wired steps to a "header" panel; the literal
// "header" was a valid edge endpoint. Steps are first-class now and
// entry steps are simply those with no incoming edge (indegree 0), so
// "header" is no longer meaningful. Reject it clearly instead of
// silently creating a phantom step named "header".

export function assertNotHeaderSentinel(tokens: Array<string | undefined>): void {
  if (tokens.some((t) => t === "header")) {
    throw new HttpError(
      400,
      "HEADER_SENTINEL_REMOVED",
      'The "header" endpoint no longer exists — workflows have no header. Entry steps are those with no incoming edge; connect steps to each other by their refs/ids.',
    );
  }
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
 *  ids referenced by the workflow's steps' reads/actions. */
export async function reconcileAttachments(
  workflowId: string,
  scope: WorkflowScope
): Promise<void> {
  const db = supabaseAdmin();
  const graph = await composeWorkflow(scope.workspaceId, workflowId);
  const wantKb = new Set<string>();
  const wantSkill = new Set<string>();
  for (const n of graph.nodes) {
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
  // an existing step in, removeNode): newly attached KBs must be readable
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

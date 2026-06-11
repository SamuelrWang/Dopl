"use client";

/**
 * useWorkflowAttachmentSync — keeps each workflow's
 * `workflow_knowledge_bases` / `workflow_skills` rows in sync with the
 * KB/skill refs docked into the nodes wired to that workflow.
 *
 * Desired attachments for a workflow = the union of every `reads` (kb /
 * file → kbId) and `actions` (skill → skillId) ref across the node panels
 * reachable from its header panel through edges. On any panel/edge change
 * we recompute, diff against the last-synced snapshot, and POST attach /
 * DELETE detach the difference. Unlike the old cluster sync there's no
 * "close preserves the attachment" nuance — refs are intrinsic to a node,
 * so removing the ref (undock) or the node (close) both drop the desired
 * set and detach.
 *
 * Ops are serialized per (workflowId, side, refId) so a fast dock/undock
 * can't land out of order. Failed ops are NOT committed into the baseline,
 * so the next render diff re-fires them.
 */

import { useEffect, useRef } from "react";
import { useCanvas, useCanvasScope } from "./canvas-store";
import type { Edge, Panel } from "./types";

interface Desired {
  kbs: Set<string>;
  skills: Set<string>;
}

type DesiredMap = Map<string, Desired>;

type Op = {
  kind: "attach-kb" | "detach-kb" | "attach-skill" | "detach-skill";
  workflowId: string;
  refId: string;
};

const pairQueues = new Map<string, Promise<unknown>>();

function pairKey(op: Op): string {
  const side =
    op.kind === "attach-kb" || op.kind === "detach-kb" ? "kb" : "skill";
  return `${side}:${op.workflowId}:${op.refId}`;
}

/** Workflow membership = node panels reachable from a header over edges. */
function computeDesired(panels: Panel[], edges: Edge[]): DesiredMap {
  const adj = new Map<string, string[]>();
  for (const e of edges) {
    adj.set(e.fromPanelId, [...(adj.get(e.fromPanelId) ?? []), e.toPanelId]);
    adj.set(e.toPanelId, [...(adj.get(e.toPanelId) ?? []), e.fromPanelId]);
  }
  const byId = new Map(panels.map((p) => [p.id, p]));
  const headerIds = new Set(
    panels.filter((p) => p.type === "workflow").map((p) => p.id)
  );
  const out: DesiredMap = new Map();

  for (const header of panels) {
    if (header.type !== "workflow") continue;
    const kbs = new Set<string>();
    const skills = new Set<string>();
    const visited = new Set<string>([header.id]);
    const queue = [header.id];
    while (queue.length > 0) {
      const cur = queue.shift()!;
      for (const nb of adj.get(cur) ?? []) {
        if (visited.has(nb)) continue;
        visited.add(nb);
        // Other workflow headers are membership boundaries — never
        // expand through them, or two wired-together workflows would
        // claim (and attach) each other's nodes. Mirrors graph.ts.
        if (headerIds.has(nb) && nb !== header.id) continue;
        queue.push(nb);
      }
    }
    for (const id of visited) {
      const p = byId.get(id);
      if (!p || p.type !== "node") continue;
      for (const r of p.reads) {
        if (r.kind === "kb" || r.kind === "file") kbs.add(r.kbId);
      }
      for (const a of p.actions) {
        if (a.kind === "skill") skills.add(a.skillId);
      }
    }
    out.set(header.workflowId, { kbs, skills });
  }
  return out;
}

function diff(current: DesiredMap, last: DesiredMap, ops: Op[]): void {
  for (const [workflowId, want] of current) {
    const had = last.get(workflowId) ?? { kbs: new Set(), skills: new Set() };
    for (const kb of want.kbs)
      if (!had.kbs.has(kb)) ops.push({ kind: "attach-kb", workflowId, refId: kb });
    for (const kb of had.kbs)
      if (!want.kbs.has(kb)) ops.push({ kind: "detach-kb", workflowId, refId: kb });
    for (const sk of want.skills)
      if (!had.skills.has(sk)) ops.push({ kind: "attach-skill", workflowId, refId: sk });
    for (const sk of had.skills)
      if (!want.skills.has(sk)) ops.push({ kind: "detach-skill", workflowId, refId: sk });
  }
  // Workflows removed entirely (header deleted) — their detach is handled
  // by the FK cascade when the workflow row is deleted, so no ops here.
}

export function useWorkflowAttachmentSync(): void {
  const { state } = useCanvas();
  const scope = useCanvasScope();
  const lastRef = useRef<DesiredMap>(new Map());
  const initializedForRef = useRef<string | null>(null);

  useEffect(() => {
    const workspaceId = scope?.workspaceId;
    if (!workspaceId) return;

    const current = computeDesired(state.panels, state.edges);

    // First run for this workspace: seed baseline silently (existing
    // attachments were migrated server-side; don't re-POST them).
    if (initializedForRef.current !== workspaceId) {
      lastRef.current = current;
      initializedForRef.current = workspaceId;
      return;
    }

    const ops: Op[] = [];
    diff(current, lastRef.current, ops);
    if (ops.length === 0) return;

    // Optimistically commit; roll back failed pairs so the next diff retries.
    const previous = lastRef.current;
    lastRef.current = current;

    void Promise.all(ops.map((op) => enqueue(op, workspaceId))).then(
      (results) => {
        const failed = results.filter((r): r is Op => r !== null);
        for (const op of failed) rollback(lastRef.current, previous, op);
      }
    );
  }, [state.panels, state.edges, scope?.workspaceId]);
}

function rollback(current: DesiredMap, previous: DesiredMap, op: Op): void {
  const side = op.kind.endsWith("kb") ? "kbs" : "skills";
  const prevWf = previous.get(op.workflowId);
  const currWf =
    current.get(op.workflowId) ?? { kbs: new Set(), skills: new Set() };
  if (!current.has(op.workflowId)) current.set(op.workflowId, currWf);
  const had = prevWf ? prevWf[side].has(op.refId) : false;
  if (had) currWf[side].add(op.refId);
  else currWf[side].delete(op.refId);
}

function enqueue(op: Op, workspaceId: string): Promise<Op | null> {
  const key = pairKey(op);
  const prev = pairQueues.get(key) ?? Promise.resolve();
  const next = prev.then(() => execute(op, workspaceId));
  pairQueues.set(
    key,
    next.catch(() => undefined)
  );
  return next.then(
    () => null,
    () => op
  );
}

async function execute(op: Op, workspaceId: string): Promise<void> {
  const isKb = op.kind === "attach-kb" || op.kind === "detach-kb";
  const isAttach = op.kind === "attach-kb" || op.kind === "attach-skill";
  const path = `/api/workflows/${encodeURIComponent(op.workflowId)}/${isKb ? "knowledge-bases" : "skills"}`;
  const body = isKb
    ? { knowledge_base_id: op.refId }
    : { skill_id: op.refId };
  const res = await fetch(path, {
    method: isAttach ? "POST" : "DELETE",
    headers: { "content-type": "application/json", "x-workspace-id": workspaceId },
    body: JSON.stringify(body),
    credentials: "same-origin",
  });
  if (!res.ok) {
    console.warn(`[workflow-attach] ${op.kind} HTTP ${res.status}`, op.workflowId, op.refId);
    throw new Error(`HTTP ${res.status}`);
  }
}

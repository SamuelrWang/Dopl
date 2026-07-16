import "server-only";

import { supabaseAdmin } from "@/shared/supabase/admin";
import { HttpError } from "@/shared/lib/http-error";
import { NODE_PANEL_SIZE, WORKFLOW_PANEL_SIZE } from "@/features/canvas/types";
import { insertEdge } from "@/features/canvas/server/edges";
import { validateKbsForWorkflow } from "./attachments";
import { resolveHeaderPanelId, shortId } from "./authoring-header";
import {
  nodeDataFrom,
  kbIdsOf,
  type ActionRefInput,
  type NodeInput,
  type NodeRef,
  type ReadRefInput,
  type ResolvedNodeData,
} from "./authoring-refs";
import {
  NODE_GAP,
  assertNodeInWorkflow,
  memberNodePanels,
  reconcileAttachments,
  writeNodePanel,
} from "./authoring-shared";
import type { WorkflowScope } from "./service";

/**
 * Per-node authoring ops: add a node and wire it in, update a node's
 * content/refs in place, and remove a node. Graph-level reconciliation is
 * in `authoring-graph`; edge ops are in `authoring-edges`.
 */

/** Create one node and connect it into the workflow. Returns its panel id. */
export async function addNode(
  workflowId: string,
  input: NodeInput,
  connectFrom: string | undefined,
  scope: WorkflowScope
): Promise<string> {
  const headerId = await resolveHeaderPanelId(workflowId, scope);
  const { title, data } = await nodeDataFrom(input, scope);
  await validateKbsForWorkflow(workflowId, kbIdsOf([data]), scope);
  const { panels } = await memberNodePanels(workflowId, scope);

  // Place to the right of the rightmost current member.
  const db = supabaseAdmin();
  const { data: headerRow } = await db
    .from("canvas_panels").select("x, y").eq("workspace_id", scope.workspaceId).eq("panel_id", headerId).single();
  const baseY = ((headerRow?.y as number) ?? 0) + WORKFLOW_PANEL_SIZE.height + 160;
  let x = (headerRow?.x as number) ?? 0;
  for (const p of panels) x = Math.max(x, ((p.x as number) ?? 0) + NODE_PANEL_SIZE.width + NODE_GAP);

  const panelId = shortId("n");
  await writeNodePanel(panelId, title, data, x, baseY, scope);

  const from = !connectFrom || connectFrom === "header" ? headerId : connectFrom;
  if (from !== panelId) {
    await insertEdge(scope.workspaceId, scope.userId, { id: crypto.randomUUID(), fromPanelId: from, toPanelId: panelId });
  }
  await reconcileAttachments(workflowId, scope);
  return panelId;
}

export async function updateNode(
  workflowId: string,
  nodeId: string,
  input: Partial<NodeInput>,
  scope: WorkflowScope
): Promise<void> {
  const db = supabaseAdmin();
  const { data: row } = await db
    .from("canvas_panels").select("panel_id, title, panel_data, x, y")
    .eq("workspace_id", scope.workspaceId).eq("panel_id", nodeId).eq("panel_type", "node").maybeSingle();
  if (!row) throw new HttpError(404, "NODE_NOT_FOUND", `Node not found: ${nodeId}`);
  await assertNodeInWorkflow(workflowId, nodeId, scope);

  const cur = (row.panel_data ?? {}) as Record<string, unknown>;
  const merged: NodeInput = {
    ref: (cur.ref as string) ?? nodeId,
    title: input.title ?? (row.title as string) ?? "",
    description: input.description ?? (cur.description as string) ?? "",
    reads: input.reads,
    actions: input.actions,
    userInput: input.userInput ?? (cur.userInput as string) ?? "",
    agentOutput: input.agentOutput ?? (cur.agentOutput as string) ?? "",
    nextInstructions: input.nextInstructions ?? (cur.nextInstructions as string) ?? "",
  };
  // Only re-resolve refs if the caller supplied them; else keep current.
  let title: string;
  let data: ResolvedNodeData;
  if (input.reads === undefined && input.actions === undefined) {
    ({ title, data } = {
      title: merged.title ?? "",
      data: {
        description: merged.description ?? "",
        reads: (cur.reads as NodeRef[]) ?? [],
        actions: (cur.actions as NodeRef[]) ?? [],
        userInput: merged.userInput ?? "",
        agentOutput: merged.agentOutput ?? "",
        nextInstructions: merged.nextInstructions ?? "",
        ref: merged.ref,
      },
    });
  } else {
    const built = await nodeDataFrom(
      { ...merged, reads: input.reads ?? (cur.reads as ReadRefInput[]) ?? [], actions: input.actions ?? (cur.actions as ActionRefInput[]) ?? [] },
      scope
    );
    title = built.title;
    data = built.data;
  }
  await validateKbsForWorkflow(workflowId, kbIdsOf([data]), scope);
  await writeNodePanel(nodeId, title, data, (row.x as number) ?? 0, (row.y as number) ?? 0, scope);
  await reconcileAttachments(workflowId, scope);
}

export async function removeNode(
  workflowId: string,
  nodeId: string,
  scope: WorkflowScope
): Promise<void> {
  await assertNodeInWorkflow(workflowId, nodeId, scope);
  const db = supabaseAdmin();
  await db.from("canvas_panels").delete()
    .eq("workspace_id", scope.workspaceId).eq("panel_id", nodeId).eq("panel_type", "node");
  // canvas_edges FK is ON DELETE CASCADE, so its edges are gone.
  await reconcileAttachments(workflowId, scope);
}

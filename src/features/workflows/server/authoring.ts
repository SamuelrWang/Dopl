import "server-only";

import { supabaseAdmin } from "@/shared/supabase/admin";
import { HttpError } from "@/shared/lib/http-error";
import { NODE_PANEL_SIZE, WORKFLOW_PANEL_SIZE } from "@/features/canvas/types";
import { insertEdge } from "@/features/canvas/server/edges";
import { composeWorkflow } from "./graph";
import type { WorkflowScope } from "./service";

/**
 * Server-side workflow GRAPH authoring (used by the MCP agent path). Writes
 * the header + node `canvas_panels` rows and `canvas_edges` that the canvas
 * renders, then reconciles `workflow_knowledge_bases` / `workflow_skills`
 * from the nodes' docked refs. The canvas realtime subscription reflects
 * these onto an open canvas live.
 *
 * Agent panel ids use `wf-` / `n-` prefixes so they never collide with the
 * client's `panel-N` counter.
 */

// ── Wire types (what the API/MCP layer passes in) ────────────────────

export interface ReadRefInput {
  kbId: string;
  /** Present → a file (entry) ref; absent → a whole-KB ref. */
  entryId?: string;
}
export interface ActionRefInput {
  skillId: string;
}
export interface NodeInput {
  /** Stable agent-chosen handle; persisted in panel_data.ref so a later
   *  set_graph matches it to the existing panel. */
  ref: string;
  title?: string;
  description?: string;
  reads?: ReadRefInput[];
  actions?: ActionRefInput[];
  userInput?: string;
  agentOutput?: string;
  nextInstructions?: string;
}
export interface EdgeInput {
  /** Node `ref` or the literal "header". */
  from: string;
  to: string;
}
export interface GraphSpec {
  nodes: NodeInput[];
  edges: EdgeInput[];
}

type NodeRef =
  | { kind: "kb"; kbId: string; name: string }
  | { kind: "file"; kbId: string; entryId: string; name: string }
  | { kind: "skill"; skillId: string; name: string };

interface ResolvedNodeData {
  description: string;
  reads: NodeRef[];
  actions: NodeRef[];
  userInput: string;
  agentOutput: string;
  nextInstructions: string;
  ref?: string;
}

// ── Header panel ─────────────────────────────────────────────────────

function shortId(prefix: string): string {
  return `${prefix}-${crypto.randomUUID().slice(0, 8)}`;
}

/** Place a new workflow to the right of all existing panels so it doesn't
 *  overlap current content. */
async function freeOrigin(workspaceId: string): Promise<{ x: number; y: number }> {
  const db = supabaseAdmin();
  const { data } = await db
    .from("canvas_panels")
    .select("x, width")
    .eq("workspace_id", workspaceId);
  let maxRight = 0;
  for (const p of data ?? []) {
    const right = (p.x ?? 0) + (p.width ?? 0);
    if (right > maxRight) maxRight = right;
  }
  return { x: maxRight + 120, y: 80 };
}

/** Insert the workflow's header panel; returns its panel_id. */
export async function spawnHeaderPanel(
  workflowId: string,
  name: string,
  description: string | null,
  scope: WorkflowScope
): Promise<string> {
  const db = supabaseAdmin();
  const origin = await freeOrigin(scope.workspaceId);
  const panelId = shortId("wf");
  const { error } = await db.from("canvas_panels").insert({
    workspace_id: scope.workspaceId,
    panel_id: panelId,
    user_id: scope.userId,
    panel_type: "workflow",
    x: origin.x,
    y: origin.y,
    width: WORKFLOW_PANEL_SIZE.width,
    height: WORKFLOW_PANEL_SIZE.height,
    panel_data: { workflowId, name, description: description ?? "" },
  });
  if (error) throw error;
  return panelId;
}

/** The header panel id for a workflow (throws if it has none). */
async function resolveHeaderPanelId(
  workflowId: string,
  workspaceId: string
): Promise<string> {
  const db = supabaseAdmin();
  const { data } = await db
    .from("canvas_panels")
    .select("panel_id, panel_data")
    .eq("workspace_id", workspaceId)
    .eq("panel_type", "workflow");
  const header = (data ?? []).find(
    (r) => (r.panel_data as { workflowId?: string } | null)?.workflowId === workflowId
  );
  if (!header) {
    throw new HttpError(
      409,
      "WORKFLOW_HAS_NO_HEADER",
      "Workflow has no header panel on the canvas; recreate it via dopl_workflow create."
    );
  }
  return header.panel_id as string;
}

// ── Ref resolution + validation ──────────────────────────────────────

/** Resolve read/action ids → named NodeRefs, validating each belongs to the
 *  workspace, is live, and is public (the canvas is workspace-shared). */
async function resolveRefs(
  reads: ReadRefInput[],
  actions: ActionRefInput[],
  scope: WorkflowScope
): Promise<{ reads: NodeRef[]; actions: NodeRef[] }> {
  const db = supabaseAdmin();
  const kbIds = [...new Set(reads.map((r) => r.kbId))];
  const entryIds = [...new Set(reads.filter((r) => r.entryId).map((r) => r.entryId!))];
  const skillIds = [...new Set(actions.map((a) => a.skillId))];

  const kbById = new Map<string, string>();
  if (kbIds.length) {
    const { data } = await db
      .from("knowledge_bases")
      .select("id, name, visibility, deleted_at")
      .in("id", kbIds)
      .eq("workspace_id", scope.workspaceId);
    for (const k of data ?? []) {
      if (k.deleted_at) continue;
      if (k.visibility === "private")
        throw new HttpError(403, "PRIVATE_RESOURCE", `Knowledge base ${k.id} is private; make it public to use it in a workflow.`);
      kbById.set(k.id, k.name);
    }
    for (const id of kbIds)
      if (!kbById.has(id)) throw new HttpError(404, "KNOWLEDGE_BASE_NOT_FOUND", `Knowledge base not found: ${id}`);
  }

  const entryById = new Map<string, { title: string; kbId: string }>();
  if (entryIds.length) {
    const { data } = await db
      .from("knowledge_entries")
      .select("id, title, knowledge_base_id, deleted_at")
      .in("id", entryIds)
      .eq("workspace_id", scope.workspaceId);
    for (const e of data ?? []) {
      if (e.deleted_at) continue;
      entryById.set(e.id, { title: e.title, kbId: e.knowledge_base_id });
    }
    for (const id of entryIds)
      if (!entryById.has(id)) throw new HttpError(404, "ENTRY_NOT_FOUND", `Entry not found: ${id}`);
  }

  const skillById = new Map<string, string>();
  if (skillIds.length) {
    const { data } = await db
      .from("skills")
      .select("id, name, visibility, deleted_at")
      .in("id", skillIds)
      .eq("workspace_id", scope.workspaceId);
    for (const s of data ?? []) {
      if (s.deleted_at) continue;
      if (s.visibility === "private")
        throw new HttpError(403, "PRIVATE_RESOURCE", `Skill ${s.id} is private; make it public to use it in a workflow.`);
      skillById.set(s.id, s.name);
    }
    for (const id of skillIds)
      if (!skillById.has(id)) throw new HttpError(404, "SKILL_NOT_FOUND", `Skill not found: ${id}`);
  }

  const resolvedReads: NodeRef[] = reads.map((r) =>
    r.entryId
      ? { kind: "file", kbId: r.kbId, entryId: r.entryId, name: entryById.get(r.entryId)!.title }
      : { kind: "kb", kbId: r.kbId, name: kbById.get(r.kbId)! }
  );
  const resolvedActions: NodeRef[] = actions.map((a) => ({
    kind: "skill",
    skillId: a.skillId,
    name: skillById.get(a.skillId)!,
  }));
  return { reads: resolvedReads, actions: resolvedActions };
}

async function nodeDataFrom(
  input: NodeInput,
  scope: WorkflowScope
): Promise<{ title: string; data: ResolvedNodeData }> {
  const { reads, actions } = await resolveRefs(input.reads ?? [], input.actions ?? [], scope);
  return {
    title: input.title ?? "",
    data: {
      description: input.description ?? "",
      reads,
      actions,
      userInput: input.userInput ?? "",
      agentOutput: input.agentOutput ?? "",
      nextInstructions: input.nextInstructions ?? "",
      ref: input.ref,
    },
  };
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

  if (kbInserts.length) await db.from("workflow_knowledge_bases").upsert(kbInserts, { onConflict: "workflow_id,knowledge_base_id" });
  if (skillInserts.length) await db.from("workflow_skills").upsert(skillInserts, { onConflict: "workflow_id,skill_id" });
  if (kbDeletes.length) await db.from("workflow_knowledge_bases").delete().eq("workflow_id", workflowId).in("knowledge_base_id", kbDeletes);
  if (skillDeletes.length) await db.from("workflow_skills").delete().eq("workflow_id", workflowId).in("skill_id", skillDeletes);
}

// ── Node + edge primitives ───────────────────────────────────────────

const NODE_GAP = 80;

async function memberNodePanels(workflowId: string, scope: WorkflowScope) {
  const db = supabaseAdmin();
  const headerId = await resolveHeaderPanelId(workflowId, scope.workspaceId);
  const graph = await composeWorkflow(scope.workspaceId, workflowId);
  const ids = (graph?.nodes ?? []).map((n) => n.id);
  const { data } = await db
    .from("canvas_panels")
    .select("panel_id, x, y, panel_data")
    .eq("workspace_id", scope.workspaceId)
    .in("panel_id", ids.length ? ids : ["__none__"]);
  return { headerId, panels: data ?? [] };
}

async function writeNodePanel(
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

async function deleteEdgeByPair(workspaceId: string, from: string, to: string): Promise<void> {
  const db = supabaseAdmin();
  await db.from("canvas_edges").delete().eq("workspace_id", workspaceId).eq("from_panel_id", from).eq("to_panel_id", to);
}

// ── Public ops ───────────────────────────────────────────────────────

/** Declarative: make the workflow's graph match `spec` exactly. */
export async function setGraph(
  workflowId: string,
  spec: GraphSpec,
  scope: WorkflowScope
): Promise<void> {
  const db = supabaseAdmin();
  const headerId = await resolveHeaderPanelId(workflowId, scope.workspaceId);

  // Resolve + validate every node's refs UPFRONT so an invalid ref aborts
  // before any write (no partial graph).
  const resolved = await Promise.all(spec.nodes.map((n) => nodeDataFrom(n, scope)));

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

/** Create one node and connect it into the workflow. Returns its panel id. */
export async function addNode(
  workflowId: string,
  input: NodeInput,
  connectFrom: string | undefined,
  scope: WorkflowScope
): Promise<string> {
  const headerId = await resolveHeaderPanelId(workflowId, scope.workspaceId);
  const { title, data } = await nodeDataFrom(input, scope);
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
  await writeNodePanel(nodeId, title, data, (row.x as number) ?? 0, (row.y as number) ?? 0, scope);
  await reconcileAttachments(workflowId, scope);
}

export async function removeNode(
  workflowId: string,
  nodeId: string,
  scope: WorkflowScope
): Promise<void> {
  const db = supabaseAdmin();
  await db.from("canvas_panels").delete()
    .eq("workspace_id", scope.workspaceId).eq("panel_id", nodeId).eq("panel_type", "node");
  // canvas_edges FK is ON DELETE CASCADE, so its edges are gone.
  await reconcileAttachments(workflowId, scope);
}

export async function connect(
  workflowId: string,
  from: string,
  to: string,
  scope: WorkflowScope
): Promise<void> {
  const headerId = await resolveHeaderPanelId(workflowId, scope.workspaceId);
  const fromId = from === "header" ? headerId : from;
  const toId = to === "header" ? headerId : to;
  if (fromId === toId) throw new HttpError(400, "SELF_EDGE", "Cannot connect a panel to itself.");
  await insertEdge(scope.workspaceId, scope.userId, { id: crypto.randomUUID(), fromPanelId: fromId, toPanelId: toId });
  await reconcileAttachments(workflowId, scope);
}

export async function disconnect(
  workflowId: string,
  from: string,
  to: string,
  scope: WorkflowScope
): Promise<void> {
  const headerId = await resolveHeaderPanelId(workflowId, scope.workspaceId);
  const fromId = from === "header" ? headerId : from;
  const toId = to === "header" ? headerId : to;
  await deleteEdgeByPair(scope.workspaceId, fromId, toId);
  await reconcileAttachments(workflowId, scope);
}

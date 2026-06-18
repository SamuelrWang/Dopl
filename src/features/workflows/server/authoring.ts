import "server-only";

import { supabaseAdmin } from "@/shared/supabase/admin";
import { HttpError } from "@/shared/lib/http-error";
import { NODE_PANEL_SIZE, WORKFLOW_PANEL_SIZE } from "@/features/canvas/types";
import { insertEdge } from "@/features/canvas/server/edges";
import { composeWorkflow } from "./graph";
import { validateKbsForWorkflow } from "./attachments";
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

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * The header panel id for a workflow. Legacy workflows migrated from
 * pre-pivot clusters may have no header panel — rather than 409, spawn one
 * on first authoring op so those workflows become authorable + visible.
 */
async function resolveHeaderPanelId(
  workflowId: string,
  scope: WorkflowScope
): Promise<string> {
  const db = supabaseAdmin();
  const { data } = await db
    .from("canvas_panels")
    .select("panel_id, panel_data")
    .eq("workspace_id", scope.workspaceId)
    .eq("panel_type", "workflow");
  const header = (data ?? []).find(
    (r) => (r.panel_data as { workflowId?: string } | null)?.workflowId === workflowId
  );
  if (header) return header.panel_id as string;

  const { data: wf } = await db
    .from("workflows")
    .select("name, description")
    .eq("id", workflowId)
    .eq("workspace_id", scope.workspaceId)
    .maybeSingle();
  if (!wf) throw new HttpError(404, "WORKFLOW_NOT_FOUND", `Workflow not found: ${workflowId}`);
  return spawnHeaderPanel(workflowId, wf.name, wf.description ?? null, scope);
}

/**
 * Map every node panel_id → the set of workflow ids whose header reaches it
 * (undirected, stopping at other headers — mirrors graph.ts). Used to keep
 * authoring ops from touching a node that belongs to a DIFFERENT workflow.
 */
async function nodeOwnership(
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
async function assertNodeInWorkflow(
  workflowId: string,
  nodeId: string,
  scope: WorkflowScope
): Promise<void> {
  const own = await nodeOwnership(scope);
  if (!own.get(nodeId)?.has(workflowId)) {
    throw new HttpError(404, "NODE_NOT_IN_WORKFLOW", `Node ${nodeId} is not part of this workflow.`);
  }
}

// ── Ref resolution + validation ──────────────────────────────────────

interface ResourceRow {
  id: string;
  slug: string;
  name: string;
  visibility: string | null;
  deleted_at: string | null;
}

/**
 * Resolve a set of kb/skill TOKENS (each a slug OR a uuid) → token → canonical
 * {id, name}, validating each belongs to the workspace, is live, and is public
 * (the canvas is workspace-shared). Agents get slugs from dopl_kb / dopl_skill,
 * so accepting either removes the "where do I find the uuid" dead-end.
 */
async function resolveResources(
  table: "knowledge_bases" | "skills",
  tokens: string[],
  label: "Knowledge base" | "Skill",
  errCode: "KNOWLEDGE_BASE_NOT_FOUND" | "SKILL_NOT_FOUND",
  scope: WorkflowScope
): Promise<Map<string, { id: string; name: string }>> {
  const out = new Map<string, { id: string; name: string }>();
  const uniq = [...new Set(tokens)];
  if (uniq.length === 0) return out;

  const db = supabaseAdmin();
  const uuids = uniq.filter((t) => UUID_RE.test(t));
  const slugs = uniq.filter((t) => !UUID_RE.test(t));
  const rows: ResourceRow[] = [];
  if (uuids.length) {
    const { data } = await db
      .from(table)
      .select("id, slug, name, visibility, deleted_at")
      .in("id", uuids)
      .eq("workspace_id", scope.workspaceId);
    rows.push(...((data ?? []) as ResourceRow[]));
  }
  if (slugs.length) {
    const { data } = await db
      .from(table)
      .select("id, slug, name, visibility, deleted_at")
      .in("slug", slugs)
      .eq("workspace_id", scope.workspaceId);
    rows.push(...((data ?? []) as ResourceRow[]));
  }

  const byId = new Map<string, ResourceRow>();
  const bySlug = new Map<string, ResourceRow>();
  for (const r of rows) {
    if (r.deleted_at) continue;
    if (r.visibility === "private")
      throw new HttpError(403, "PRIVATE_RESOURCE", `${label} \`${r.slug}\` is private; make it public to use it in a workflow.`);
    byId.set(r.id, r);
    bySlug.set(r.slug, r);
  }
  for (const t of uniq) {
    const row = UUID_RE.test(t) ? byId.get(t) : bySlug.get(t);
    if (!row) throw new HttpError(404, errCode, `${label} not found: ${t}`);
    out.set(t, { id: row.id, name: row.name });
  }
  return out;
}

/** Resolve read/action refs → named NodeRefs (kb/skill ids accept slug OR
 *  uuid; entryId is a uuid). Stored NodeRefs always carry canonical uuids. */
async function resolveRefs(
  reads: ReadRefInput[],
  actions: ActionRefInput[],
  scope: WorkflowScope
): Promise<{ reads: NodeRef[]; actions: NodeRef[] }> {
  const db = supabaseAdmin();
  const kbCanon = await resolveResources(
    "knowledge_bases",
    reads.map((r) => r.kbId),
    "Knowledge base",
    "KNOWLEDGE_BASE_NOT_FOUND",
    scope
  );
  const skillCanon = await resolveResources(
    "skills",
    actions.map((a) => a.skillId),
    "Skill",
    "SKILL_NOT_FOUND",
    scope
  );

  const entryIds = [...new Set(reads.filter((r) => r.entryId).map((r) => r.entryId!))];
  const entryById = new Map<string, { title: string }>();
  if (entryIds.length) {
    const { data } = await db
      .from("knowledge_entries")
      .select("id, title, deleted_at")
      .in("id", entryIds)
      .eq("workspace_id", scope.workspaceId);
    for (const e of data ?? []) {
      if (e.deleted_at) continue;
      entryById.set(e.id, { title: e.title });
    }
    for (const id of entryIds)
      if (!entryById.has(id)) throw new HttpError(404, "ENTRY_NOT_FOUND", `Entry not found: ${id}`);
  }

  const resolvedReads: NodeRef[] = reads.map((r) => {
    const kb = kbCanon.get(r.kbId)!;
    return r.entryId
      ? { kind: "file", kbId: kb.id, entryId: r.entryId, name: entryById.get(r.entryId)!.title }
      : { kind: "kb", kbId: kb.id, name: kb.name };
  });
  const resolvedActions: NodeRef[] = actions.map((a) => {
    const sk = skillCanon.get(a.skillId)!;
    return { kind: "skill", skillId: sk.id, name: sk.name };
  });
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

/** Distinct KB ids referenced by resolved node data (kb + file reads). */
function kbIdsOf(datas: ResolvedNodeData[]): string[] {
  const ids = new Set<string>();
  for (const d of datas)
    for (const r of d.reads)
      if (r.kind === "kb" || r.kind === "file") ids.add(r.kbId);
  return [...ids];
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

// ── Node + edge primitives ───────────────────────────────────────────

const NODE_GAP = 80;

async function memberNodePanels(workflowId: string, scope: WorkflowScope) {
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

async function deleteEdgeByPair(workspaceId: string, from: string, to: string): Promise<number> {
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

// ── Public ops ───────────────────────────────────────────────────────

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

export async function connect(
  workflowId: string,
  from: string,
  to: string,
  scope: WorkflowScope
): Promise<void> {
  const headerId = await resolveHeaderPanelId(workflowId, scope);
  const fromId = from === "header" ? headerId : from;
  const toId = to === "header" ? headerId : to;
  if (fromId === toId) throw new HttpError(400, "SELF_EDGE", "Cannot connect a panel to itself.");

  // Don't let an agent wire in a node that already belongs to a DIFFERENT
  // workflow (it would become dual-homed). Isolated nodes + this workflow's
  // own nodes are fine.
  const own = await nodeOwnership(scope);
  for (const endpoint of [fromId, toId]) {
    if (endpoint === headerId) continue;
    const owners = own.get(endpoint);
    if (owners && [...owners].some((w) => w !== workflowId)) {
      throw new HttpError(400, "NODE_IN_OTHER_WORKFLOW", `Panel ${endpoint} belongs to a different workflow; connect within one workflow.`);
    }
  }

  await insertEdge(scope.workspaceId, scope.userId, { id: crypto.randomUUID(), fromPanelId: fromId, toPanelId: toId });
  await reconcileAttachments(workflowId, scope);
}

export async function disconnect(
  workflowId: string,
  from: string,
  to: string,
  scope: WorkflowScope
): Promise<void> {
  const headerId = await resolveHeaderPanelId(workflowId, scope);
  const fromId = from === "header" ? headerId : from;
  const toId = to === "header" ? headerId : to;
  const deleted = await deleteEdgeByPair(scope.workspaceId, fromId, toId);
  if (deleted === 0) {
    throw new HttpError(
      404,
      "EDGE_NOT_FOUND",
      `No edge ${from} → ${to} in this workflow — nothing to disconnect.`,
    );
  }
  await reconcileAttachments(workflowId, scope);
}

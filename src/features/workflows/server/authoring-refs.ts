import "server-only";

import { supabaseAdmin } from "@/shared/supabase/admin";
import { HttpError } from "@/shared/lib/http-error";
import type { WorkflowStepRead, WorkflowStepAction } from "../types";
import type { WorkflowScope } from "./service";

/**
 * Wire types (what the API/MCP layer passes in) + ref resolution and
 * validation. Turns agent-supplied kb/skill/entry tokens (each a slug OR
 * a uuid) into canonical, workspace-scoped, public-only `NodeRef`s. Used
 * by the graph + node authoring ops; edge ops don't touch refs.
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
  /** Source step `ref`. */
  from: string;
  /** Target step `ref`. */
  to: string;
  /** Optional branch guard (agent-readable free text); '' = unconditional. */
  condition?: string;
}
export interface GraphSpec {
  nodes: NodeInput[];
  edges: EdgeInput[];
}

export interface ResolvedNodeData {
  description: string;
  reads: WorkflowStepRead[];
  actions: WorkflowStepAction[];
  userInput: string;
  agentOutput: string;
  nextInstructions: string;
  ref?: string;
}

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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
): Promise<{ reads: WorkflowStepRead[]; actions: WorkflowStepAction[] }> {
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

  const resolvedReads: WorkflowStepRead[] = reads.map((r) => {
    const kb = kbCanon.get(r.kbId)!;
    return r.entryId
      ? { kind: "file", kbId: kb.id, entryId: r.entryId, name: entryById.get(r.entryId)!.title }
      : { kind: "kb", kbId: kb.id, name: kb.name };
  });
  const resolvedActions: WorkflowStepAction[] = actions.map((a) => {
    const sk = skillCanon.get(a.skillId)!;
    return { kind: "skill", skillId: sk.id, name: sk.name };
  });
  return { reads: resolvedReads, actions: resolvedActions };
}

export async function nodeDataFrom(
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
export function kbIdsOf(datas: ResolvedNodeData[]): string[] {
  const ids = new Set<string>();
  for (const d of datas)
    for (const r of d.reads)
      if (r.kind === "kb" || r.kind === "file") ids.add(r.kbId);
  return [...ids];
}

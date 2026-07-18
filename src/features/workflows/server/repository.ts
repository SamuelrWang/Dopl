import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { isUuid } from "@/shared/lib/id/uuid";
import type {
  WorkflowStep,
  WorkflowStepAction,
  WorkflowStepRead,
  WorkflowEdge,
} from "../types";

/**
 * Pure data access for `workflow_steps` + `workflow_step_edges`. One
 * function per query; every function takes the Supabase client (never
 * creates one) and maps snake_case rows → camelCase domain types at this
 * boundary. Business logic (compose, authoring diff) lives in graph.ts /
 * authoring-*.ts.
 */

// ── Row shapes ───────────────────────────────────────────────────────

interface StepRow {
  id: string;
  workflow_id: string;
  workspace_id: string;
  ref: string;
  title: string;
  description: string;
  reads: unknown;
  actions: unknown;
  user_input: string;
  agent_output: string;
  next_instructions: string;
  position: number;
}

interface EdgeRow {
  id: string;
  workflow_id: string;
  workspace_id: string;
  from_step_id: string;
  to_step_id: string;
  condition: string;
}

const STEP_COLS =
  "id, workflow_id, workspace_id, ref, title, description, reads, actions, user_input, agent_output, next_instructions, position";
const EDGE_COLS =
  "id, workflow_id, workspace_id, from_step_id, to_step_id, condition";

// ── DTO mappers ──────────────────────────────────────────────────────

export function mapStepRow(row: StepRow): WorkflowStep {
  return {
    id: row.id,
    ref: row.ref,
    title: row.title ?? "",
    description: row.description ?? "",
    reads: Array.isArray(row.reads) ? (row.reads as WorkflowStepRead[]) : [],
    actions: Array.isArray(row.actions)
      ? (row.actions as WorkflowStepAction[])
      : [],
    userInput: row.user_input ?? "",
    agentOutput: row.agent_output ?? "",
    nextInstructions: row.next_instructions ?? "",
  };
}

export function mapEdgeRow(row: EdgeRow): WorkflowEdge {
  return {
    id: row.id,
    fromStepId: row.from_step_id,
    toStepId: row.to_step_id,
    condition: row.condition ?? "",
  };
}

/** Fields a step write persists (id/ref identify; the rest is content). */
export interface StepWrite {
  ref: string;
  title: string;
  description: string;
  reads: WorkflowStepRead[];
  actions: WorkflowStepAction[];
  userInput: string;
  agentOutput: string;
  nextInstructions: string;
  position: number;
}

function stepWriteRow(
  workflowId: string,
  workspaceId: string,
  w: StepWrite
): Record<string, unknown> {
  return {
    workflow_id: workflowId,
    workspace_id: workspaceId,
    ref: w.ref,
    title: w.title,
    description: w.description,
    reads: w.reads,
    actions: w.actions,
    user_input: w.userInput,
    agent_output: w.agentOutput,
    next_instructions: w.nextInstructions,
    position: w.position,
  };
}

// ── Reads ────────────────────────────────────────────────────────────

/** Every step of a workflow, ordered by `position` then created_at (stable
 *  topo-sort tie-break). */
export async function listSteps(
  db: SupabaseClient,
  workspaceId: string,
  workflowId: string
): Promise<WorkflowStep[]> {
  const { data, error } = await db
    .from("workflow_steps")
    .select(STEP_COLS)
    .eq("workspace_id", workspaceId)
    .eq("workflow_id", workflowId)
    .order("position", { ascending: true })
    .order("created_at", { ascending: true });
  if (error) throw error;
  return (data ?? []).map((r) => mapStepRow(r as StepRow));
}

/** Every edge of a workflow, deterministically ordered. */
export async function listEdges(
  db: SupabaseClient,
  workspaceId: string,
  workflowId: string
): Promise<WorkflowEdge[]> {
  const { data, error } = await db
    .from("workflow_step_edges")
    .select(EDGE_COLS)
    .eq("workspace_id", workspaceId)
    .eq("workflow_id", workflowId)
    .order("from_step_id", { ascending: true })
    .order("to_step_id", { ascending: true });
  if (error) throw error;
  return (data ?? []).map((r) => mapEdgeRow(r as EdgeRow));
}

/** Resolve a step within a workflow by its uuid OR its stable ref. A
 *  uuid-shaped token is matched against `id`, otherwise against `ref`
 *  (avoids interpolating caller input into a PostgREST `.or()` filter).
 *  Returns the row's id + ref, or null when no such step exists here. */
export async function findStep(
  db: SupabaseClient,
  workspaceId: string,
  workflowId: string,
  idOrRef: string
): Promise<{ id: string; ref: string } | null> {
  const { data, error } = await db
    .from("workflow_steps")
    .select("id, ref")
    .eq("workspace_id", workspaceId)
    .eq("workflow_id", workflowId)
    .eq(isUuid(idOrRef) ? "id" : "ref", idOrRef)
    .maybeSingle();
  if (error) throw error;
  return data ? { id: data.id as string, ref: data.ref as string } : null;
}

/** Fetch one full step (by uuid or ref) with its `position`, or null. */
export async function getStep(
  db: SupabaseClient,
  workspaceId: string,
  workflowId: string,
  idOrRef: string
): Promise<(WorkflowStep & { position: number }) | null> {
  const { data, error } = await db
    .from("workflow_steps")
    .select(STEP_COLS)
    .eq("workspace_id", workspaceId)
    .eq("workflow_id", workflowId)
    .eq(isUuid(idOrRef) ? "id" : "ref", idOrRef)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;
  const row = data as StepRow;
  return { ...mapStepRow(row), position: row.position };
}

/** Count of steps in a workflow (append position for add_node). */
export async function countSteps(
  db: SupabaseClient,
  workspaceId: string,
  workflowId: string
): Promise<number> {
  const { count, error } = await db
    .from("workflow_steps")
    .select("id", { count: "exact", head: true })
    .eq("workspace_id", workspaceId)
    .eq("workflow_id", workflowId);
  if (error) throw error;
  return count ?? 0;
}

// ── Writes ───────────────────────────────────────────────────────────

/** Insert a new step; returns its id. */
export async function insertStep(
  db: SupabaseClient,
  workspaceId: string,
  workflowId: string,
  write: StepWrite
): Promise<string> {
  const { data, error } = await db
    .from("workflow_steps")
    .insert(stepWriteRow(workflowId, workspaceId, write))
    .select("id")
    .single();
  if (error) throw error;
  return data.id as string;
}

/** Overwrite an existing step's content (addressed by id). */
export async function updateStep(
  db: SupabaseClient,
  workspaceId: string,
  workflowId: string,
  stepId: string,
  write: StepWrite
): Promise<void> {
  const { error } = await db
    .from("workflow_steps")
    .update({
      ref: write.ref,
      title: write.title,
      description: write.description,
      reads: write.reads,
      actions: write.actions,
      user_input: write.userInput,
      agent_output: write.agentOutput,
      next_instructions: write.nextInstructions,
      position: write.position,
      updated_at: new Date().toISOString(),
    })
    .eq("workspace_id", workspaceId)
    .eq("workflow_id", workflowId)
    .eq("id", stepId);
  if (error) throw error;
}

export async function deleteStep(
  db: SupabaseClient,
  workspaceId: string,
  workflowId: string,
  stepId: string
): Promise<void> {
  const { error } = await db
    .from("workflow_steps")
    .delete()
    .eq("workspace_id", workspaceId)
    .eq("workflow_id", workflowId)
    .eq("id", stepId);
  if (error) throw error;
}

/**
 * PERMANENT hard-delete of ONE workflow row, guarded to TRASHED rows only
 * (`deleted_at IS NOT NULL`) and pinned to its workspace as defense-in-depth —
 * a live row or a cross-workspace id removes nothing. FK `ON DELETE CASCADE`
 * sweeps its steps, step-edges, and KB/skill junctions; the
 * `workflow_deleted_grant_cleanup` trigger drops its team grants. Returns rows
 * removed so a caller can tell a real purge from a no-op (already live/restored).
 */
export async function hardDeleteWorkflow(
  db: SupabaseClient,
  workspaceId: string,
  workflowId: string
): Promise<number> {
  const { data, error } = await db
    .from("workflows")
    .delete()
    .eq("id", workflowId)
    .eq("workspace_id", workspaceId)
    .not("deleted_at", "is", null)
    .select("id");
  if (error) throw error;
  return data?.length ?? 0;
}

/** Insert an edge (idempotent on the (workflow, from, to) unique key). */
export async function insertEdge(
  db: SupabaseClient,
  workspaceId: string,
  workflowId: string,
  fromStepId: string,
  toStepId: string,
  condition: string
): Promise<void> {
  const { error } = await db.from("workflow_step_edges").upsert(
    {
      workflow_id: workflowId,
      workspace_id: workspaceId,
      from_step_id: fromStepId,
      to_step_id: toStepId,
      condition,
    },
    { onConflict: "workflow_id,from_step_id,to_step_id" }
  );
  if (error) throw error;
}

/** Delete the edge between a pair; returns how many rows were removed so a
 *  caller can 404 a no-op disconnect instead of reporting a false success. */
export async function deleteEdge(
  db: SupabaseClient,
  workspaceId: string,
  workflowId: string,
  fromStepId: string,
  toStepId: string
): Promise<number> {
  const { data, error } = await db
    .from("workflow_step_edges")
    .delete()
    .eq("workspace_id", workspaceId)
    .eq("workflow_id", workflowId)
    .eq("from_step_id", fromStepId)
    .eq("to_step_id", toStepId)
    .select("id");
  if (error) throw error;
  return data?.length ?? 0;
}

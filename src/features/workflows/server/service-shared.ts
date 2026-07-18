import "server-only";

import type { GraphLayout } from "@/shared/graph";
import { supabaseAdmin } from "@/shared/supabase/admin";
import { HttpError } from "@/shared/lib/http-error";
import type { Role } from "@/features/workspaces/types";
import type { WorkflowGraph } from "./graph";
import {
  listAttachedKnowledgeBasesById,
  listAttachedSkillsById,
  type WorkflowAttachedKnowledgeBase,
  type WorkflowAttachedSkill,
} from "./attachments";

/**
 * Shared internals for the workflows service split: the domain types +
 * cross-cutting helpers used by more than one of the per-domain service
 * modules (`service.ts` CRUD, `service-trash.ts` soft-delete lifecycle).
 * Both import from here so neither depends on the other (no import cycle),
 * mirroring the chats feature's `service-shared`.
 */

// ── Types ────────────────────────────────────────────────────────────

export interface WorkflowRow {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  cluster_id: string | null;
  /** 'workspace' = every member; 'teams' = granted teams only. */
  access_mode: "workspace" | "teams";
  /** Creator (retains edit on teams-mode workflows). */
  user_id: string | null;
  /** Persisted dragged step positions (id → {x,y}); `{}` = pure auto-layout. */
  layout: GraphLayout;
  created_at: string;
  updated_at: string;
  step_count: number;
  knowledge_base_count: number;
  skill_count: number;
  knowledge_base_names: string[];
  skill_names: string[];
}

export interface WorkflowDetail extends WorkflowRow {
  knowledge_bases: WorkflowAttachedKnowledgeBase[];
  skills: WorkflowAttachedSkill[];
  /** Step graph composed from workflow_steps + workflow_step_edges. */
  graph: WorkflowGraph | null;
}

export interface WorkflowCreateRequest {
  /** Client-generated id so a UI can create the row + author it in one flow. */
  id?: string;
  name: string;
  description?: string | null;
  clusterId?: string | null;
}

export interface WorkflowUpdateRequest {
  name?: string;
  description?: string | null;
  clusterId?: string | null;
  /** Web-only: dragged step positions. Agents (MCP) never send this. */
  layout?: GraphLayout;
}

export interface WorkflowScope {
  workspaceId: string;
  userId: string;
  /** Caller's workspace role — used for team-access resolution without refetching membership. */
  role: Role;
  source: "user" | "agent";
}

/** A soft-deleted workflow, as surfaced in the (feature-local) trash view. */
export interface WorkflowTrashRow {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  deleted_at: string;
}

/**
 * Trash-list projection for the unified workspace Trash page: one
 * soft-deleted workflow in the shared `{ kind, id, name, deletedAt }` shape
 * (the same shape the chats trash list uses, `kind` discriminating).
 */
export interface TrashedWorkflow {
  kind: "workflow";
  id: string;
  name: string;
  deletedAt: string;
}

export const SELECT_COLS =
  "id, slug, name, description, cluster_id, access_mode, user_id, layout, created_at, updated_at";

// ── Helpers ──────────────────────────────────────────────────────────

/**
 * Canonical stored form for a workflow's DISPLAY name: trim only. F-24 —
 * the display name used to be run through `normalizeClusterName`, which
 * uppercased it and collapsed whitespace to underscores (so a caller's
 * `swarm-wf-pipeline` was stored as `SWARM-WF-PIPELINE`). The URL SLUG is a
 * separate concern and is still normalized by `slugifyWorkflowName`; the
 * display name now preserves the caller's casing and spacing verbatim.
 */
export function normalizeWorkflowName(name: string): string {
  return name.trim();
}

/**
 * `cluster_id` is caller-supplied; the FK alone only proves the cluster
 * exists SOMEWHERE — without this check a member of workspace A could
 * point a workflow at workspace B's cluster (and use the FK error as an
 * existence oracle for cluster uuids).
 */
export async function assertClusterInWorkspace(
  clusterId: string,
  workspaceId: string
): Promise<void> {
  const db = supabaseAdmin();
  const { data } = await db
    .from("clusters")
    .select("id")
    .eq("id", clusterId)
    .eq("workspace_id", workspaceId)
    .maybeSingle();
  if (!data) {
    throw new HttpError(404, "CLUSTER_NOT_FOUND", "Cluster not found");
  }
}

/** Live attachment counts/names for a workflow row (list-shape fields). */
export async function attachmentSummary(
  workflowId: string,
  scope: WorkflowScope
): Promise<
  Pick<
    WorkflowRow,
    | "knowledge_base_count"
    | "skill_count"
    | "knowledge_base_names"
    | "skill_names"
  >
> {
  const [knowledge_bases, skills] = await Promise.all([
    listAttachedKnowledgeBasesById(workflowId, scope),
    listAttachedSkillsById(workflowId, scope),
  ]);
  return {
    knowledge_base_count: knowledge_bases.length,
    skill_count: skills.length,
    knowledge_base_names: knowledge_bases.map((k) => k.name),
    skill_names: skills.map((s) => s.name),
  };
}

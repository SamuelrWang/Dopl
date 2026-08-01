import "server-only";

import type { GraphLayout } from "@/shared/graph";
import { supabaseAdmin } from "@/shared/supabase/admin";
import { HttpError } from "@/shared/lib/http-error";
import type { Role } from "@/features/workspaces/types";
import { listEffectiveAccess, resolveLevel } from "@/features/teams/server/access";
import type { EffectiveAccessResult } from "@/features/teams/types";
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

/**
 * The rows any caller needs to decide whether a workflow is visible: its id,
 * its access mode, and its creator. Deliberately structural rather than
 * `WorkflowRow` — the trash listing and the cluster rollup both select narrow
 * projections, and neither should have to over-select to reuse the rule.
 */
export interface WorkflowVisibilityRow {
  id: string;
  access_mode: "workspace" | "teams";
  user_id: string | null;
}

/**
 * THE workflow visibility rule — one definition, every listing.
 *
 * Drops teams-mode workflows the caller holds no grant on (the creator and
 * admins always pass). It was written out by hand in three places
 * (`listWorkflows`, `listTrash`, and — not at all — the cluster rollup), and
 * the copy that was never written is exactly the disclosure that shipped:
 * `dopl_cluster` handed back the names, slugs and descriptions of team-scoped
 * workflows that `dopl_workflow(op="list")` hides. Two implementations of a
 * visibility rule drift, and the one that drifts is the one that stops
 * filtering — so callers import this and there is nothing left to drift.
 *
 * Mirrors `filterTeamVisibleBases` in the knowledge feature. Soft-delete is NOT
 * this function's job: `deleted_at` lives in the query each caller already
 * writes, and the trash listing deliberately selects the deleted rows.
 */
export async function filterTeamVisibleWorkflows<T extends WorkflowVisibilityRow>(
  rows: T[],
  scope: { workspaceId: string; userId: string; role?: Role }
): Promise<T[]> {
  if (rows.length === 0) return [];
  const access = await listEffectiveAccess(scope.workspaceId, scope.userId, {
    role: scope.role,
  });
  return rows.filter((r) => workflowVisibleTo(access, r, scope.userId));
}

/**
 * The rule itself, as a pure predicate against an already-batched access
 * result. `listWorkflows` needs that batch anyway (to filter attached KB
 * names), so it resolves access once and calls this directly rather than
 * paying a second `listEffectiveAccess` round trip for the same answer.
 * `null` access = not an active member: nothing team-scoped is reachable.
 */
export function workflowVisibleTo(
  access: EffectiveAccessResult | null,
  row: WorkflowVisibilityRow,
  userId: string
): boolean {
  if (access === null) return row.access_mode !== "teams";
  return (
    row.user_id === userId ||
    resolveLevel(access, "workflow", row.id, row.access_mode) !== null
  );
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

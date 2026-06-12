import "server-only";
import { supabaseAdmin } from "@/shared/supabase/admin";
import { meetsMinRole, type Role } from "@/features/workspaces/types";
import type { KbTeamConflict } from "../types";
import { TeamKbAccessConflictError } from "./errors";
import {
  findTeamById,
  getResourceAccessMeta,
  insertReadGrantsIfMissing,
  listGrantsForResource,
  listGrantsForResources,
  listKnowledgeBaseAccessMetas,
  listTeamsForWorkspace,
} from "./repository";

/**
 * Workflow↔KB invariant: every team that can read a workflow must be able
 * to read every KB attached to it. Workspace-mode workflows have an
 * audience of "all members", so they can never carry a teams-mode KB
 * (autoGrant cannot fix that case — the KB itself must change scope).
 */
export type WorkflowAudience = "all" | string[];

/** The teams whose members can read this workflow right now. */
export async function computeWorkflowAudience(
  workspaceId: string,
  workflowId: string
): Promise<WorkflowAudience> {
  const meta = await getResourceAccessMeta(workspaceId, "workflow", workflowId);
  if (!meta || meta.accessMode === "workspace") return "all";
  const grants = await listGrantsForResource(workspaceId, "workflow", workflowId);
  return grants.map((g) => g.teamId);
}

/**
 * Validate that attaching `kbIds` to a workflow keeps the invariant for
 * the given audience. On violation: if `autoGrant` is set and the caller
 * is admin+ and every conflict is team-resolvable, create the missing
 * read grants (never downgrading existing ones) and return; otherwise
 * throw TeamKbAccessConflictError (409) with the structured payload.
 */
export async function validateWorkflowKbInvariant(args: {
  workspaceId: string;
  workflowId: string;
  workflowName: string;
  kbIds: string[];
  audience: WorkflowAudience;
  autoGrant?: { callerId: string; role: Role };
}): Promise<void> {
  const kbIds = [...new Set(args.kbIds)];
  if (kbIds.length === 0) return;

  const metas = await listKnowledgeBaseAccessMetas(args.workspaceId, kbIds);
  const scoped = metas.filter((m) => m.accessMode === "teams");
  if (scoped.length === 0) return;

  // Empty team audience (teams-mode workflow with no grants yet) can't
  // conflict — nobody but admins/creator can read the workflow.
  if (args.audience !== "all" && args.audience.length === 0) return;

  const grants = await listGrantsForResources(
    args.workspaceId,
    "knowledge_base",
    scoped.map((m) => m.id)
  );
  const grantedTeamsByKb = new Map<string, Set<string>>();
  for (const g of grants) {
    const set = grantedTeamsByKb.get(g.resourceId) ?? new Set<string>();
    set.add(g.teamId);
    grantedTeamsByKb.set(g.resourceId, set);
  }

  const teamNames = await teamNameMap(args.workspaceId, args.audience);
  const conflicts: KbTeamConflict[] = [];
  for (const kb of scoped) {
    if (args.audience === "all") {
      conflicts.push({
        knowledgeBaseId: kb.id,
        knowledgeBaseName: kb.name,
        teams: [],
        audienceIsAllMembers: true,
      });
      continue;
    }
    const granted = grantedTeamsByKb.get(kb.id) ?? new Set<string>();
    const missing = args.audience.filter((teamId) => !granted.has(teamId));
    if (missing.length > 0) {
      conflicts.push({
        knowledgeBaseId: kb.id,
        knowledgeBaseName: kb.name,
        teams: missing.map((teamId) => ({
          teamId,
          teamName: teamNames.get(teamId) ?? "Unknown team",
        })),
        audienceIsAllMembers: false,
      });
    }
  }
  if (conflicts.length === 0) return;

  const autoGrantResolvable = conflicts.every((c) => !c.audienceIsAllMembers);
  if (
    args.autoGrant &&
    autoGrantResolvable &&
    meetsMinRole(args.autoGrant.role, "admin")
  ) {
    await Promise.all(
      conflicts.map((c) =>
        insertReadGrantsIfMissing(
          args.workspaceId,
          "knowledge_base",
          c.knowledgeBaseId,
          c.teams.map((t) => t.teamId)
        )
      )
    );
    return;
  }

  throw new TeamKbAccessConflictError({
    workflowId: args.workflowId,
    workflowName: args.workflowName,
    conflicts,
    autoGrantResolvable,
  });
}

/**
 * Reverse direction: a team is about to lose read on a KB (grant removal
 * or the KB flipping to teams-mode). Throws 409 if any workflow attached
 * to the KB still has that team — or everyone — in its audience.
 *
 * `losingTeamIds` semantics:
 *   - specific team ids: those teams are losing access
 *   - "allUngranted": the KB is flipping workspace->teams; every audience
 *     member without an explicit grant loses access
 */
export async function validateKbNarrowing(args: {
  workspaceId: string;
  knowledgeBaseId: string;
  knowledgeBaseName: string;
  losingTeamIds: string[] | "allUngranted";
}): Promise<void> {
  const workflows = await listWorkflowsAttachedToKb(
    args.workspaceId,
    args.knowledgeBaseId
  );
  if (workflows.length === 0) return;

  const grantedTeams = new Set(
    (
      await listGrantsForResource(
        args.workspaceId,
        "knowledge_base",
        args.knowledgeBaseId
      )
    ).map((g) => g.teamId)
  );

  for (const wf of workflows) {
    const audience = await computeWorkflowAudience(args.workspaceId, wf.id);
    let losing: Array<{ teamId: string; teamName: string }> = [];
    let audienceIsAllMembers = false;

    if (audience === "all") {
      // Whole workspace reads the workflow; any narrowing of an attached
      // KB breaks the invariant for non-granted members.
      audienceIsAllMembers = true;
    } else if (args.losingTeamIds === "allUngranted") {
      const names = await teamNameMap(args.workspaceId, audience);
      losing = audience
        .filter((teamId) => !grantedTeams.has(teamId))
        .map((teamId) => ({
          teamId,
          teamName: names.get(teamId) ?? "Unknown team",
        }));
    } else {
      const losingSet = new Set(args.losingTeamIds);
      const names = await teamNameMap(args.workspaceId, audience);
      losing = audience
        .filter((teamId) => losingSet.has(teamId))
        .map((teamId) => ({
          teamId,
          teamName: names.get(teamId) ?? "Unknown team",
        }));
    }

    if (audienceIsAllMembers || losing.length > 0) {
      throw new TeamKbAccessConflictError({
        workflowId: wf.id,
        workflowName: wf.name,
        conflicts: [
          {
            knowledgeBaseId: args.knowledgeBaseId,
            knowledgeBaseName: args.knowledgeBaseName,
            teams: losing,
            audienceIsAllMembers,
          },
        ],
        // Fix is on the other side (narrow the workflow or keep the grant).
        autoGrantResolvable: false,
      });
    }
  }
}

/**
 * A KB is going private: everyone except the owner/admins loses read.
 * Covers both audience shapes with the existing narrowing check — first
 * the ungranted side (all-members / non-granted teams), then the
 * currently granted teams (their grants get deleted on the flip).
 */
export async function validateKbGoingPrivate(args: {
  workspaceId: string;
  knowledgeBaseId: string;
  knowledgeBaseName: string;
}): Promise<void> {
  await validateKbNarrowing({ ...args, losingTeamIds: "allUngranted" });
  const granted = await listGrantsForResource(
    args.workspaceId,
    "knowledge_base",
    args.knowledgeBaseId
  );
  if (granted.length > 0) {
    await validateKbNarrowing({
      ...args,
      losingTeamIds: granted.map((g) => g.teamId),
    });
  }
}

async function listWorkflowsAttachedToKb(
  workspaceId: string,
  knowledgeBaseId: string
): Promise<Array<{ id: string; name: string }>> {
  const db = supabaseAdmin();
  const { data, error } = await db
    .from("workflow_knowledge_bases")
    .select("workflow:workflows!inner(id, name)")
    .eq("workspace_id", workspaceId)
    .eq("knowledge_base_id", knowledgeBaseId);
  if (error) throw error;
  const rows = (data ?? []) as unknown as Array<{
    workflow: { id: string; name: string } | Array<{ id: string; name: string }>;
  }>;
  const out: Array<{ id: string; name: string }> = [];
  for (const row of rows) {
    const wf = Array.isArray(row.workflow) ? row.workflow[0] : row.workflow;
    if (wf) out.push(wf);
  }
  return out;
}

async function teamNameMap(
  workspaceId: string,
  audience: WorkflowAudience
): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  if (audience === "all" || audience.length === 0) return map;
  if (audience.length === 1) {
    const team = await findTeamById(workspaceId, audience[0]);
    if (team) map.set(team.id, team.name);
    return map;
  }
  const teams = await listTeamsForWorkspace(workspaceId);
  for (const t of teams) map.set(t.id, t.name);
  return map;
}

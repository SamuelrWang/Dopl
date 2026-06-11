import "server-only";
import { HttpError } from "@/shared/lib/http-error";
import { meetsMinRole, type Role } from "@/features/workspaces/types";
import { findMembership } from "@/features/workspaces/server/repository";
import type { AccessLevel, AccessMode, TeamResourceType } from "../access-levels";
import type {
  AccessMatrix,
  AccessMatrixResource,
  Team,
  TeamView,
} from "../types";
import type { TeamCreateInput, TeamUpdateInput } from "../schema";
import { TeamNotFoundError } from "./errors";
import {
  computeWorkflowAudience,
  validateKbNarrowing,
  validateWorkflowKbInvariant,
} from "./invariant";
import {
  deleteGrantRow,
  deleteTeamMemberRow,
  deleteTeamRow,
  findTeamById,
  getResourceAccessMeta,
  insertTeam,
  insertTeamMembers,
  listGrantsForTeam,
  listGrantsForTeams,
  listTeamMembers,
  listTeamMembersForWorkspace,
  listTeamsForWorkspace,
  setResourceAccessModeRow,
  updateTeamRow,
  upsertGrant,
} from "./repository";
import { supabaseAdmin } from "@/shared/supabase/admin";

/* --------------------------- role gates --------------------------- */

async function requireMember(workspaceId: string, callerId: string): Promise<Role> {
  const membership = await findMembership(workspaceId, callerId);
  if (!membership || membership.status !== "active") {
    throw new HttpError(404, "WORKSPACE_NOT_FOUND", "Workspace not found");
  }
  return membership.role;
}

async function requireAdmin(workspaceId: string, callerId: string): Promise<Role> {
  const role = await requireMember(workspaceId, callerId);
  if (!meetsMinRole(role, "admin")) {
    throw new HttpError(403, "WORKSPACE_FORBIDDEN", "Admin role or higher required");
  }
  return role;
}

/* --------------------------- team CRUD ---------------------------- */

export async function createTeam(
  workspaceId: string,
  callerId: string,
  input: TeamCreateInput
): Promise<TeamView> {
  const role = await requireAdmin(workspaceId, callerId);

  const team = await insertTeamOrConflict({
    workspaceId,
    name: input.name,
    description: input.description ?? null,
    color: input.color ?? null,
    icon: input.icon ?? null,
    createdBy: callerId,
  });

  try {
    if (input.memberIds?.length) {
      await assertActiveMembers(workspaceId, input.memberIds);
      await insertTeamMembers(team.id, workspaceId, input.memberIds, callerId);
    }

    // KB grants first so a same-payload workflow grant sees them when the
    // invariant computes the new team's readable KBs.
    const grants = [...(input.grants ?? [])].sort((a) =>
      a.resourceType === "knowledge_base" ? -1 : 1
    );
    for (const grant of grants) {
      await setTeamGrant(
        workspaceId,
        callerId,
        team.id,
        grant.resourceType,
        grant.resourceId,
        grant.level,
        { role, autoGrant: input.autoGrant }
      );
    }
  } catch (err) {
    // Roll back the half-created team so a conflict-then-retry doesn't
    // trip the unique name constraint (or leave an orphan).
    await deleteTeamRow(team.id).catch(() => {});
    throw err;
  }

  return hydrateTeamView(team);
}

export async function updateTeam(
  workspaceId: string,
  callerId: string,
  teamId: string,
  patch: TeamUpdateInput
): Promise<Team> {
  await requireAdmin(workspaceId, callerId);
  const team = await findTeamById(workspaceId, teamId);
  if (!team) throw new TeamNotFoundError();
  try {
    return await updateTeamRow(teamId, patch);
  } catch (err) {
    throw asNameConflict(err);
  }
}

export async function deleteTeam(
  workspaceId: string,
  callerId: string,
  teamId: string
): Promise<void> {
  await requireAdmin(workspaceId, callerId);
  const team = await findTeamById(workspaceId, teamId);
  if (!team) throw new TeamNotFoundError();
  // Members + grants cascade via FK. Removing a team's grants can never
  // break the workflow↔KB invariant: the team leaves both audiences at once.
  await deleteTeamRow(teamId);
}

export async function listTeams(
  workspaceId: string,
  callerId: string
): Promise<TeamView[]> {
  await requireMember(workspaceId, callerId);
  const [teams, memberRows, grants] = await Promise.all([
    listTeamsForWorkspace(workspaceId),
    listTeamMembersForWorkspace(workspaceId),
    listGrantsForTeams(workspaceId),
  ]);
  const membersByTeam = groupBy(memberRows, (m) => m.teamId);
  const grantsByTeam = groupBy(grants, (g) => g.teamId);
  return teams.map((t) => ({
    ...t,
    memberCount: membersByTeam.get(t.id)?.length ?? 0,
    memberIds: (membersByTeam.get(t.id) ?? []).map((m) => m.userId),
    grants: grantsByTeam.get(t.id) ?? [],
  }));
}

export async function getTeam(
  workspaceId: string,
  callerId: string,
  teamId: string
): Promise<TeamView> {
  await requireMember(workspaceId, callerId);
  const team = await findTeamById(workspaceId, teamId);
  if (!team) throw new TeamNotFoundError();
  return hydrateTeamView(team);
}

/* ------------------------- team membership ------------------------ */

export async function addTeamMembers(
  workspaceId: string,
  callerId: string,
  teamId: string,
  userIds: string[]
): Promise<void> {
  await requireAdmin(workspaceId, callerId);
  const team = await findTeamById(workspaceId, teamId);
  if (!team) throw new TeamNotFoundError();
  await assertActiveMembers(workspaceId, userIds);
  await insertTeamMembers(teamId, workspaceId, userIds, callerId);
}

export async function removeTeamMember(
  workspaceId: string,
  callerId: string,
  teamId: string,
  userId: string
): Promise<void> {
  await requireAdmin(workspaceId, callerId);
  const team = await findTeamById(workspaceId, teamId);
  if (!team) throw new TeamNotFoundError();
  await deleteTeamMemberRow(teamId, userId);
}

/* ----------------------------- grants ----------------------------- */

/**
 * Set or update a team's grant on a resource. Workflow grants are
 * invariant-checked: the widened audience must be able to read every
 * attached KB (autoGrant lets the admin create the missing read grants).
 */
export async function setTeamGrant(
  workspaceId: string,
  callerId: string,
  teamId: string,
  resourceType: TeamResourceType,
  resourceId: string,
  level: AccessLevel,
  opts?: { autoGrant?: boolean; role?: Role }
): Promise<void> {
  const role = opts?.role ?? (await requireAdmin(workspaceId, callerId));
  const team = await findTeamById(workspaceId, teamId);
  if (!team) throw new TeamNotFoundError();
  const meta = await getResourceAccessMeta(workspaceId, resourceType, resourceId);
  if (!meta) {
    throw new HttpError(404, "RESOURCE_NOT_FOUND", `${resourceType.replace("_", " ")} not found`);
  }

  if (resourceType === "workflow") {
    const audience = await computeWorkflowAudience(workspaceId, resourceId);
    const widened = audience === "all" ? "all" : [...new Set([...audience, teamId])];
    const attachedKbIds = await listAttachedKbIds(workspaceId, resourceId);
    await validateWorkflowKbInvariant({
      workspaceId,
      workflowId: resourceId,
      workflowName: meta.name,
      kbIds: attachedKbIds,
      audience: widened,
      autoGrant: opts?.autoGrant ? { callerId, role } : undefined,
    });
  }

  await upsertGrant(workspaceId, teamId, resourceType, resourceId, level);
}

/**
 * Remove a team's grant. Removing a KB grant is invariant-checked: any
 * workflow whose audience still contains this team must not depend on it.
 */
export async function removeTeamGrant(
  workspaceId: string,
  callerId: string,
  teamId: string,
  resourceType: TeamResourceType,
  resourceId: string
): Promise<void> {
  await requireAdmin(workspaceId, callerId);
  const team = await findTeamById(workspaceId, teamId);
  if (!team) throw new TeamNotFoundError();

  if (resourceType === "knowledge_base") {
    const meta = await getResourceAccessMeta(workspaceId, resourceType, resourceId);
    if (meta && meta.accessMode === "teams") {
      await validateKbNarrowing({
        workspaceId,
        knowledgeBaseId: resourceId,
        knowledgeBaseName: meta.name,
        losingTeamIds: [teamId],
      });
    }
  }

  await deleteGrantRow(teamId, resourceType, resourceId);
}

/* --------------------------- access mode -------------------------- */

/**
 * Flip a resource between workspace-wide and teams-scoped access.
 *
 *   KB -> teams:       narrowing; checked against attached workflows.
 *   workflow -> workspace: audience widens to everyone; every attached
 *                          teams-mode KB becomes a conflict.
 *   KB -> workspace / workflow -> teams: pure widening/narrowing of the
 *                          resource itself, never breaks the invariant.
 */
export async function setResourceAccessMode(
  workspaceId: string,
  callerId: string,
  resourceType: TeamResourceType,
  resourceId: string,
  mode: AccessMode,
  opts?: { autoGrant?: boolean }
): Promise<void> {
  const role = await requireAdmin(workspaceId, callerId);
  const meta = await getResourceAccessMeta(workspaceId, resourceType, resourceId);
  if (!meta) {
    throw new HttpError(404, "RESOURCE_NOT_FOUND", `${resourceType.replace("_", " ")} not found`);
  }
  if (meta.accessMode === mode) return;

  if (resourceType === "knowledge_base" && mode === "teams") {
    await validateKbNarrowing({
      workspaceId,
      knowledgeBaseId: resourceId,
      knowledgeBaseName: meta.name,
      losingTeamIds: "allUngranted",
    });
  }

  if (resourceType === "workflow" && mode === "workspace") {
    const attachedKbIds = await listAttachedKbIds(workspaceId, resourceId);
    await validateWorkflowKbInvariant({
      workspaceId,
      workflowId: resourceId,
      workflowName: meta.name,
      kbIds: attachedKbIds,
      audience: "all",
      autoGrant: opts?.autoGrant ? { callerId, role } : undefined,
    });
  }

  await setResourceAccessModeRow(workspaceId, resourceType, resourceId, mode);
}

/* -------------------------- access matrix ------------------------- */

export async function getAccessMatrix(
  workspaceId: string,
  callerId: string
): Promise<AccessMatrix> {
  await requireMember(workspaceId, callerId);
  const db = supabaseAdmin();
  const [teams, kbs, wfs] = await Promise.all([
    listTeams(workspaceId, callerId),
    db
      .from("knowledge_bases")
      .select("id, name, access_mode, created_by")
      .eq("workspace_id", workspaceId)
      .is("deleted_at", null)
      .order("name"),
    db
      .from("workflows")
      .select("id, name, access_mode, user_id")
      .eq("workspace_id", workspaceId)
      .order("name"),
  ]);
  if (kbs.error) throw kbs.error;
  if (wfs.error) throw wfs.error;

  const resources: AccessMatrixResource[] = [
    ...((kbs.data ?? []) as Array<{
      id: string;
      name: string;
      access_mode: AccessMode;
      created_by: string | null;
    }>).map((r) => ({
      resourceType: "knowledge_base" as const,
      resourceId: r.id,
      name: r.name,
      accessMode: r.access_mode,
      createdBy: r.created_by,
    })),
    ...((wfs.data ?? []) as Array<{
      id: string;
      name: string;
      access_mode: AccessMode;
      user_id: string | null;
    }>).map((r) => ({
      resourceType: "workflow" as const,
      resourceId: r.id,
      name: r.name,
      accessMode: r.access_mode,
      createdBy: r.user_id,
    })),
  ];

  return { teams, resources };
}

/* ----------------------------- helpers ---------------------------- */

function groupBy<T>(items: T[], key: (item: T) => string): Map<string, T[]> {
  const out = new Map<string, T[]>();
  for (const item of items) {
    const k = key(item);
    const list = out.get(k) ?? [];
    list.push(item);
    out.set(k, list);
  }
  return out;
}

async function hydrateTeamView(team: Team): Promise<TeamView> {
  const [members, grants] = await Promise.all([
    listTeamMembers(team.id),
    listGrantsForTeam(team.id),
  ]);
  return {
    ...team,
    memberCount: members.length,
    memberIds: members.map((m) => m.userId),
    grants,
  };
}

async function assertActiveMembers(
  workspaceId: string,
  userIds: string[]
): Promise<void> {
  if (userIds.length === 0) return;
  const db = supabaseAdmin();
  const { data, error } = await db
    .from("workspace_members")
    .select("user_id")
    .eq("workspace_id", workspaceId)
    .eq("status", "active")
    .in("user_id", userIds);
  if (error) throw error;
  const active = new Set(((data ?? []) as Array<{ user_id: string }>).map((r) => r.user_id));
  const missing = userIds.filter((id) => !active.has(id));
  if (missing.length > 0) {
    throw new HttpError(
      400,
      "NOT_ACTIVE_MEMBERS",
      "Some users are not active members of this workspace",
      { userIds: missing }
    );
  }
}

async function listAttachedKbIds(
  workspaceId: string,
  workflowId: string
): Promise<string[]> {
  const db = supabaseAdmin();
  const { data, error } = await db
    .from("workflow_knowledge_bases")
    .select("knowledge_base_id")
    .eq("workspace_id", workspaceId)
    .eq("workflow_id", workflowId);
  if (error) throw error;
  return ((data ?? []) as Array<{ knowledge_base_id: string }>).map(
    (r) => r.knowledge_base_id
  );
}

async function insertTeamOrConflict(args: {
  workspaceId: string;
  name: string;
  description: string | null;
  color: string | null;
  icon: string | null;
  createdBy: string;
}): Promise<Team> {
  try {
    return await insertTeam(args);
  } catch (err) {
    throw asNameConflict(err);
  }
}

function asNameConflict(err: unknown): unknown {
  if (err && typeof err === "object") {
    const code = (err as { code?: unknown }).code;
    const message = (err as { message?: unknown }).message;
    const isUnique =
      code === "23505" || (typeof message === "string" && message.includes("23505"));
    if (isUnique) {
      return new HttpError(
        409,
        "TEAM_NAME_TAKEN",
        "A team with this name already exists in the workspace"
      );
    }
  }
  return err;
}

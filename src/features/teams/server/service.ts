import "server-only";
import { HttpError } from "@/shared/lib/http-error";
import { requireWorkspaceRole } from "@/features/workspaces/server/authz";
import { meetsMinRole, type Role } from "@/features/workspaces/types";
import type { AccessLevel, AccessMode, TeamResourceType } from "../access-levels";
import type {
  AccessMatrix,
  AccessMatrixResource,
  Team,
  TeamView,
} from "../types";
import type { TeamCreateInput, TeamUpdateInput } from "../schema";
import { TeamNotFoundError } from "./errors";
import { listEffectiveAccess, resolveLevel } from "./access";
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

/* --------------------------- team CRUD ---------------------------- */

export async function createTeam(
  workspaceId: string,
  callerId: string,
  input: TeamCreateInput
): Promise<TeamView> {
  const role = await requireWorkspaceRole(workspaceId, callerId, "admin");

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

    for (const grant of input.grants ?? []) {
      await setTeamGrant(
        workspaceId,
        callerId,
        team.id,
        grant.resourceType,
        grant.resourceId,
        grant.level,
        { role }
      );
    }
  } catch (err) {
    // Roll back the half-created team so a retry doesn't trip the unique name
    // constraint or leave an orphan.
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
  await requireWorkspaceRole(workspaceId, callerId, "admin");
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
  await requireWorkspaceRole(workspaceId, callerId, "admin");
  const team = await findTeamById(workspaceId, teamId);
  if (!team) throw new TeamNotFoundError();
  // Members + grants cascade via FK.
  await deleteTeamRow(teamId);
}

export async function listTeams(
  workspaceId: string,
  callerId: string
): Promise<TeamView[]> {
  await requireWorkspaceRole(workspaceId, callerId, "viewer");
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
  await requireWorkspaceRole(workspaceId, callerId, "viewer");
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
  await requireWorkspaceRole(workspaceId, callerId, "admin");
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
  await requireWorkspaceRole(workspaceId, callerId, "admin");
  const team = await findTeamById(workspaceId, teamId);
  if (!team) throw new TeamNotFoundError();
  await deleteTeamMemberRow(teamId, userId);
}

/* ----------------------------- grants ----------------------------- */

/** Set or update a team's grant on a resource. No cross-resource check. */
export async function setTeamGrant(
  workspaceId: string,
  callerId: string,
  teamId: string,
  resourceType: TeamResourceType,
  resourceId: string,
  level: AccessLevel,
  opts?: { role?: Role }
): Promise<void> {
  if (!opts?.role) await requireWorkspaceRole(workspaceId, callerId, "admin");
  const team = await findTeamById(workspaceId, teamId);
  if (!team) throw new TeamNotFoundError();
  const meta = await getResourceAccessMeta(workspaceId, resourceType, resourceId);
  if (!meta) {
    throw new HttpError(404, "RESOURCE_NOT_FOUND", `${resourceType.replace("_", " ")} not found`);
  }

  await upsertGrant(workspaceId, teamId, resourceType, resourceId, level);
}

/** Remove a team's grant. */
export async function removeTeamGrant(
  workspaceId: string,
  callerId: string,
  teamId: string,
  resourceType: TeamResourceType,
  resourceId: string
): Promise<void> {
  await requireWorkspaceRole(workspaceId, callerId, "admin");
  const team = await findTeamById(workspaceId, teamId);
  if (!team) throw new TeamNotFoundError();

  await deleteGrantRow(teamId, resourceType, resourceId);
}

/* --------------------------- access mode -------------------------- */

/** Flip a resource between workspace-wide and teams-scoped. Both directions
 *  are a pure widening/narrowing of the resource itself. */
export async function setResourceAccessMode(
  workspaceId: string,
  callerId: string,
  resourceType: TeamResourceType,
  resourceId: string,
  mode: AccessMode
): Promise<void> {
  await requireWorkspaceRole(workspaceId, callerId, "admin");
  const meta = await getResourceAccessMeta(workspaceId, resourceType, resourceId);
  if (!meta) {
    throw new HttpError(404, "RESOURCE_NOT_FOUND", `${resourceType.replace("_", " ")} not found`);
  }
  if (meta.accessMode === mode) return;

  await setResourceAccessModeRow(workspaceId, resourceType, resourceId, mode);
}

/* -------------------------- access matrix ------------------------- */

export async function getAccessMatrix(
  workspaceId: string,
  callerId: string
): Promise<AccessMatrix> {
  const callerRole = await requireWorkspaceRole(workspaceId, callerId, "viewer");
  const db = supabaseAdmin();
  const [teams, kbs, skills] = await Promise.all([
    listTeams(workspaceId, callerId),
    db
      .from("knowledge_bases")
      .select("id, name, access_mode, created_by")
      .eq("workspace_id", workspaceId)
      .is("deleted_at", null)
      .order("name"),
    db
      .from("skills")
      .select("id, name, access_mode, created_by")
      .eq("workspace_id", workspaceId)
      .is("deleted_at", null)
      .order("name"),
  ]);
  if (kbs.error) throw kbs.error;
  if (skills.error) throw skills.error;

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
    ...((skills.data ?? []) as Array<{
      id: string;
      name: string;
      access_mode: AccessMode;
      created_by: string | null;
    }>).map((r) => ({
      resourceType: "skill" as const,
      resourceId: r.id,
      name: r.name,
      accessMode: r.access_mode,
      createdBy: r.created_by,
    })),
  ];

  // ⚠ Non-admins must not learn the names of teams-mode resources they hold
  // no grant on: the per-resource gates 404 those, so this payload must not
  // become the side channel.
  if (!meetsMinRole(callerRole, "admin")) {
    const access = await listEffectiveAccess(workspaceId, callerId, {
      role: callerRole,
    });
    const visible =
      access === null
        ? []
        : resources.filter(
            (r) =>
              r.createdBy === callerId ||
              resolveLevel(access, r.resourceType, r.resourceId, r.accessMode) !==
                null
          );
    return { teams, resources: visible };
  }

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

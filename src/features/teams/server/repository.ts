import "server-only";
import { supabaseAdmin } from "@/shared/supabase/admin";
import type { AccessLevel, AccessMode, TeamResourceType } from "../access-levels";
import type { MemberTeamRef, Team, TeamGrant, TeamMemberRow } from "../types";
import {
  mapTeamGrantRow,
  mapTeamMemberRow,
  mapTeamRow,
  type TeamGrantDbRow,
  type TeamMemberDbRow,
  type TeamRow,
} from "./dto";

const TEAM_COLS =
  "id, workspace_id, name, description, color, icon, created_by, created_at, updated_at";
const TEAM_MEMBER_COLS = "team_id, user_id, added_by, added_at";
const GRANT_COLS = "team_id, resource_type, resource_id, level";

/* ----------------------------- teams ----------------------------- */

export async function insertTeam(args: {
  workspaceId: string;
  name: string;
  description?: string | null;
  color?: string | null;
  icon?: string | null;
  createdBy: string;
}): Promise<Team> {
  const db = supabaseAdmin();
  const { data, error } = await db
    .from("teams")
    .insert({
      workspace_id: args.workspaceId,
      name: args.name,
      description: args.description ?? null,
      color: args.color ?? null,
      icon: args.icon ?? null,
      created_by: args.createdBy,
    })
    .select(TEAM_COLS)
    .single();
  if (error || !data) throw error || new Error("Failed to create team");
  return mapTeamRow(data as TeamRow);
}

export async function updateTeamRow(
  teamId: string,
  patch: {
    name?: string;
    description?: string | null;
    color?: string | null;
    icon?: string | null;
  }
): Promise<Team> {
  const db = supabaseAdmin();
  const update: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (patch.name !== undefined) update.name = patch.name;
  if (patch.description !== undefined) update.description = patch.description;
  if (patch.color !== undefined) update.color = patch.color;
  if (patch.icon !== undefined) update.icon = patch.icon;
  const { data, error } = await db
    .from("teams")
    .update(update)
    .eq("id", teamId)
    .select(TEAM_COLS)
    .single();
  if (error || !data) throw error || new Error("Failed to update team");
  return mapTeamRow(data as TeamRow);
}

export async function deleteTeamRow(teamId: string): Promise<void> {
  const db = supabaseAdmin();
  const { error } = await db.from("teams").delete().eq("id", teamId);
  if (error) throw error;
}

export async function findTeamById(
  workspaceId: string,
  teamId: string
): Promise<Team | null> {
  const db = supabaseAdmin();
  const { data, error } = await db
    .from("teams")
    .select(TEAM_COLS)
    .eq("workspace_id", workspaceId)
    .eq("id", teamId)
    .maybeSingle();
  if (error) throw error;
  return data ? mapTeamRow(data as TeamRow) : null;
}

export async function listTeamsForWorkspace(workspaceId: string): Promise<Team[]> {
  const db = supabaseAdmin();
  const { data, error } = await db
    .from("teams")
    .select(TEAM_COLS)
    .eq("workspace_id", workspaceId)
    .order("created_at", { ascending: true });
  if (error) throw error;
  return ((data ?? []) as TeamRow[]).map(mapTeamRow);
}

/* -------------------------- team members ------------------------- */

export async function listTeamMembers(teamId: string): Promise<TeamMemberRow[]> {
  const db = supabaseAdmin();
  const { data, error } = await db
    .from("team_members")
    .select(TEAM_MEMBER_COLS)
    .eq("team_id", teamId)
    .order("added_at", { ascending: true });
  if (error) throw error;
  return ((data ?? []) as TeamMemberDbRow[]).map(mapTeamMemberRow);
}

/** All membership rows in the workspace, for hydrating list views in one query. */
export async function listTeamMembersForWorkspace(
  workspaceId: string
): Promise<TeamMemberRow[]> {
  const db = supabaseAdmin();
  const { data, error } = await db
    .from("team_members")
    .select(TEAM_MEMBER_COLS)
    .eq("workspace_id", workspaceId);
  if (error) throw error;
  return ((data ?? []) as TeamMemberDbRow[]).map(mapTeamMemberRow);
}

export async function insertTeamMembers(
  teamId: string,
  workspaceId: string,
  userIds: string[],
  addedBy: string | null
): Promise<void> {
  if (userIds.length === 0) return;
  const db = supabaseAdmin();
  const { error } = await db.from("team_members").upsert(
    userIds.map((userId) => ({
      team_id: teamId,
      user_id: userId,
      workspace_id: workspaceId,
      added_by: addedBy,
    })),
    { onConflict: "team_id,user_id", ignoreDuplicates: true }
  );
  if (error) throw error;
}

export async function deleteTeamMemberRow(
  teamId: string,
  userId: string
): Promise<void> {
  const db = supabaseAdmin();
  const { error } = await db
    .from("team_members")
    .delete()
    .eq("team_id", teamId)
    .eq("user_id", userId);
  if (error) throw error;
}

export async function listTeamIdsForUser(
  workspaceId: string,
  userId: string
): Promise<string[]> {
  const db = supabaseAdmin();
  const { data, error } = await db
    .from("team_members")
    .select("team_id")
    .eq("workspace_id", workspaceId)
    .eq("user_id", userId);
  if (error) throw error;
  return ((data ?? []) as Array<{ team_id: string }>).map((r) => r.team_id);
}

/** userId -> team chip refs, for the members-list hydration (one query + team join). */
export async function listTeamRefsByUser(
  workspaceId: string
): Promise<Map<string, MemberTeamRef[]>> {
  const db = supabaseAdmin();
  const { data, error } = await db
    .from("team_members")
    .select("user_id, team:teams!inner(id, name, color, icon)")
    .eq("workspace_id", workspaceId);
  if (error) throw error;
  const rows = (data ?? []) as unknown as Array<{
    user_id: string;
    team: { id: string; name: string; color: string | null; icon: string | null } | Array<{
      id: string;
      name: string;
      color: string | null;
      icon: string | null;
    }>;
  }>;
  const out = new Map<string, MemberTeamRef[]>();
  for (const row of rows) {
    const t = Array.isArray(row.team) ? row.team[0] : row.team;
    if (!t) continue;
    const refs = out.get(row.user_id) ?? [];
    refs.push({ teamId: t.id, name: t.name, color: t.color, icon: t.icon });
    out.set(row.user_id, refs);
  }
  return out;
}

/* ----------------------------- grants ---------------------------- */

export async function listGrantsForTeam(teamId: string): Promise<TeamGrant[]> {
  const db = supabaseAdmin();
  const { data, error } = await db
    .from("team_resource_access")
    .select(GRANT_COLS)
    .eq("team_id", teamId);
  if (error) throw error;
  return ((data ?? []) as TeamGrantDbRow[]).map(mapTeamGrantRow);
}

/** All grants in the workspace, optionally narrowed to a set of teams. */
export async function listGrantsForTeams(
  workspaceId: string,
  teamIds?: string[]
): Promise<TeamGrant[]> {
  if (teamIds && teamIds.length === 0) return [];
  const db = supabaseAdmin();
  let query = db
    .from("team_resource_access")
    .select(GRANT_COLS)
    .eq("workspace_id", workspaceId);
  if (teamIds) query = query.in("team_id", teamIds);
  const { data, error } = await query;
  if (error) throw error;
  return ((data ?? []) as TeamGrantDbRow[]).map(mapTeamGrantRow);
}

export async function listGrantsForResource(
  workspaceId: string,
  resourceType: TeamResourceType,
  resourceId: string
): Promise<TeamGrant[]> {
  const db = supabaseAdmin();
  const { data, error } = await db
    .from("team_resource_access")
    .select(GRANT_COLS)
    .eq("workspace_id", workspaceId)
    .eq("resource_type", resourceType)
    .eq("resource_id", resourceId);
  if (error) throw error;
  return ((data ?? []) as TeamGrantDbRow[]).map(mapTeamGrantRow);
}

export async function upsertGrant(
  workspaceId: string,
  teamId: string,
  resourceType: TeamResourceType,
  resourceId: string,
  level: AccessLevel
): Promise<void> {
  const db = supabaseAdmin();
  const { error } = await db.from("team_resource_access").upsert(
    {
      team_id: teamId,
      resource_type: resourceType,
      resource_id: resourceId,
      workspace_id: workspaceId,
      level,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "team_id,resource_type,resource_id" }
  );
  if (error) throw error;
}

/** Insert read grants only where no grant exists yet (autoGrant never downgrades). */
export async function insertReadGrantsIfMissing(
  workspaceId: string,
  resourceType: TeamResourceType,
  resourceId: string,
  teamIds: string[]
): Promise<void> {
  if (teamIds.length === 0) return;
  const db = supabaseAdmin();
  const { error } = await db.from("team_resource_access").upsert(
    teamIds.map((teamId) => ({
      team_id: teamId,
      resource_type: resourceType,
      resource_id: resourceId,
      workspace_id: workspaceId,
      level: "read" as AccessLevel,
    })),
    { onConflict: "team_id,resource_type,resource_id", ignoreDuplicates: true }
  );
  if (error) throw error;
}

/** Grants for many resources of one type in one query (invariant checks). */
export async function listGrantsForResources(
  workspaceId: string,
  resourceType: TeamResourceType,
  resourceIds: string[]
): Promise<TeamGrant[]> {
  if (resourceIds.length === 0) return [];
  const db = supabaseAdmin();
  const { data, error } = await db
    .from("team_resource_access")
    .select(GRANT_COLS)
    .eq("workspace_id", workspaceId)
    .eq("resource_type", resourceType)
    .in("resource_id", resourceIds);
  if (error) throw error;
  return ((data ?? []) as TeamGrantDbRow[]).map(mapTeamGrantRow);
}

/** Drop every team grant on one resource (KB going private). */
export async function deleteGrantsForResource(
  workspaceId: string,
  resourceType: TeamResourceType,
  resourceId: string
): Promise<void> {
  const db = supabaseAdmin();
  const { error } = await db
    .from("team_resource_access")
    .delete()
    .eq("workspace_id", workspaceId)
    .eq("resource_type", resourceType)
    .eq("resource_id", resourceId);
  if (error) throw error;
}

export async function deleteGrantRow(
  teamId: string,
  resourceType: TeamResourceType,
  resourceId: string
): Promise<void> {
  const db = supabaseAdmin();
  const { error } = await db
    .from("team_resource_access")
    .delete()
    .eq("team_id", teamId)
    .eq("resource_type", resourceType)
    .eq("resource_id", resourceId);
  if (error) throw error;
}

/* ----------------------- scoped resources ------------------------ */

export interface TeamsModeResourceRow {
  resourceType: TeamResourceType;
  resourceId: string;
  createdBy: string | null;
}

/** Every teams-mode resource in the workspace (live KBs + workflows + skills). */
export async function listTeamsModeResources(
  workspaceId: string
): Promise<TeamsModeResourceRow[]> {
  const db = supabaseAdmin();
  const [kbs, wfs, skills] = await Promise.all([
    db
      .from("knowledge_bases")
      .select("id, created_by")
      .eq("workspace_id", workspaceId)
      .eq("access_mode", "teams")
      .is("deleted_at", null),
    db
      .from("workflows")
      .select("id, user_id")
      .eq("workspace_id", workspaceId)
      .eq("access_mode", "teams"),
    db
      .from("skills")
      .select("id, created_by")
      .eq("workspace_id", workspaceId)
      .eq("access_mode", "teams")
      .is("deleted_at", null),
  ]);
  if (kbs.error) throw kbs.error;
  if (wfs.error) throw wfs.error;
  if (skills.error) throw skills.error;
  return [
    ...((kbs.data ?? []) as Array<{ id: string; created_by: string | null }>).map(
      (r) => ({
        resourceType: "knowledge_base" as const,
        resourceId: r.id,
        createdBy: r.created_by,
      })
    ),
    ...((wfs.data ?? []) as Array<{ id: string; user_id: string | null }>).map(
      (r) => ({
        resourceType: "workflow" as const,
        resourceId: r.id,
        createdBy: r.user_id,
      })
    ),
    ...((skills.data ?? []) as Array<{ id: string; created_by: string | null }>).map(
      (r) => ({
        resourceType: "skill" as const,
        resourceId: r.id,
        createdBy: r.created_by,
      })
    ),
  ];
}

/** name + access_mode for a batch of live KBs (invariant checks). */
export async function listKnowledgeBaseAccessMetas(
  workspaceId: string,
  kbIds: string[]
): Promise<Array<{ id: string; name: string; accessMode: AccessMode }>> {
  if (kbIds.length === 0) return [];
  const db = supabaseAdmin();
  const { data, error } = await db
    .from("knowledge_bases")
    .select("id, name, access_mode")
    .eq("workspace_id", workspaceId)
    .in("id", kbIds)
    .is("deleted_at", null);
  if (error) throw error;
  return ((data ?? []) as Array<{ id: string; name: string; access_mode: AccessMode }>).map(
    (r) => ({ id: r.id, name: r.name, accessMode: r.access_mode })
  );
}

export interface ResourceAccessMeta {
  name: string;
  accessMode: AccessMode;
  createdBy: string | null;
}

/**
 * access_mode + creator + name for one resource; null if missing.
 * Soft-deleted KBs are INCLUDED on purpose: access checks must still
 * resolve for trash restore (existence gating for reads happens in the
 * knowledge service's own lookups, which already exclude deleted rows).
 */
export async function getResourceAccessMeta(
  workspaceId: string,
  resourceType: TeamResourceType,
  resourceId: string
): Promise<ResourceAccessMeta | null> {
  const db = supabaseAdmin();
  if (resourceType === "knowledge_base" || resourceType === "skill") {
    const { data, error } = await db
      .from(resourceType === "knowledge_base" ? "knowledge_bases" : "skills")
      .select("name, access_mode, created_by")
      .eq("workspace_id", workspaceId)
      .eq("id", resourceId)
      .maybeSingle();
    if (error) throw error;
    if (!data) return null;
    const row = data as { name: string; access_mode: AccessMode; created_by: string | null };
    return { name: row.name, accessMode: row.access_mode, createdBy: row.created_by };
  }
  const { data, error } = await db
    .from("workflows")
    .select("name, access_mode, user_id")
    .eq("workspace_id", workspaceId)
    .eq("id", resourceId)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;
  const row = data as { name: string; access_mode: AccessMode; user_id: string | null };
  return { name: row.name, accessMode: row.access_mode, createdBy: row.user_id };
}

export async function setResourceAccessModeRow(
  workspaceId: string,
  resourceType: TeamResourceType,
  resourceId: string,
  mode: AccessMode
): Promise<void> {
  const db = supabaseAdmin();
  const table = resourceType === "knowledge_base" ? "knowledge_bases" : "workflows";
  const { error } = await db
    .from(table)
    .update({ access_mode: mode, updated_at: new Date().toISOString() })
    .eq("workspace_id", workspaceId)
    .eq("id", resourceId);
  if (error) throw error;
}

/* ----------------------- invitation teams ------------------------ */

export async function listInvitationTeamIds(invitationId: string): Promise<string[]> {
  const db = supabaseAdmin();
  const { data, error } = await db
    .from("workspace_invitation_teams")
    .select("team_id")
    .eq("invitation_id", invitationId);
  if (error) throw error;
  return ((data ?? []) as Array<{ team_id: string }>).map((r) => r.team_id);
}

export async function replaceInvitationTeams(
  invitationId: string,
  teamIds: string[]
): Promise<void> {
  const db = supabaseAdmin();
  const { error: delError } = await db
    .from("workspace_invitation_teams")
    .delete()
    .eq("invitation_id", invitationId);
  if (delError) throw delError;
  if (teamIds.length === 0) return;
  const { error } = await db
    .from("workspace_invitation_teams")
    .insert(teamIds.map((teamId) => ({ invitation_id: invitationId, team_id: teamId })));
  if (error) throw error;
}

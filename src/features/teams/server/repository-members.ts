import "server-only";
import { supabaseAdmin } from "@/shared/supabase/admin";
import type { MemberTeamRef, TeamMemberRow } from "../types";
import { mapTeamMemberRow, type TeamMemberDbRow } from "./dto";

/**
 * The two membership tables. `team_members` is membership NOW;
 * `workspace_invitation_teams` is membership ON ACCEPT — the teams an invitee
 * joins, replayed by `workspaces/server/invitations.ts` through
 * `insertTeamMembers` here.
 * ⚠ Raw Supabase I/O: every workspace-wide query filters by `workspace_id`.
 */

const TEAM_MEMBER_COLS = "team_id, user_id, added_by, added_at";

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

/** All membership rows in the workspace — hydrates list views in one query. */
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

/** userId → team chip refs for members-list hydration; one query + join. */
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

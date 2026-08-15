import "server-only";
import { supabaseAdmin } from "@/shared/supabase/admin";
import type { Team } from "../types";
import { mapTeamRow, type TeamRow } from "./dto";

/**
 * The `teams` table itself, and the barrel for the rest of the repository:
 *   repository.ts            `teams` rows (here)
 *   repository-members.ts    `team_members` + `workspace_invitation_teams`
 *   repository-grants.ts     `team_resource_access`
 *   repository-resources.ts  the tables a grant can point AT
 * ⚠ Keep the re-exports: this module is the address outside callers import,
 * including `vi.mock("@/features/teams/server/repository")` in the chats
 * tests. New call sites inside `teams/server/` should import the concern
 * module directly.
 */
export * from "./repository-members";
export * from "./repository-grants";
export * from "./repository-resources";

const TEAM_COLS =
  "id, workspace_id, name, description, color, icon, created_by, created_at, updated_at";

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

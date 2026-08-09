import "server-only";
import { supabaseAdmin } from "@/shared/supabase/admin";
import type { Team } from "../types";
import { mapTeamRow, type TeamRow } from "./dto";

/**
 * THE `teams` TABLE ITSELF — and the entry point for the rest of the teams
 * repository.
 *
 * SPLIT 2026-08-08 (§2 cap; the row that had said "509, just over: watch it"
 * while the file reached 625). Four reasons to change had accumulated in one
 * file and are now four files, on the seams the data already had — one table
 * group each, no behavior touched and not a single query altered:
 *
 *   repository.ts            the `teams` rows (here)
 *   repository-members.ts    `team_members` + `workspace_invitation_teams`
 *   repository-grants.ts     `team_resource_access`
 *   repository-resources.ts  the five tables a grant can point AT
 *
 * The re-exports below are the `session-io.js` precedent (§2): this module
 * stays the address every caller already imports — `teams/server/service.ts`,
 * `access.ts`, `invariant.ts`, and five call sites in other features plus the
 * `vi.mock("@/features/teams/server/repository")` in the chats tests — so the
 * split moved code without moving anyone's import. New call sites inside
 * `teams/server/` should import the concern directly.
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

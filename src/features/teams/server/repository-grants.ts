import "server-only";
import { supabaseAdmin } from "@/shared/supabase/admin";
import type { AccessLevel, TeamResourceType } from "../access-levels";
import type { TeamGrant } from "../types";
import { mapTeamGrantRow, type TeamGrantDbRow } from "./dto";

/**
 * Every read and write of `team_resource_access`. Nothing here touches the
 * resource's own table — what a grant POINTS AT lives in
 * `repository-resources.ts`. A grant row is only ever
 * (team, resource_type, resource_id, level).
 * ⚠ Raw Supabase I/O: every query not pinned to a single `team_id` is
 * filtered by `workspace_id`.
 */

const GRANT_COLS = "team_id, resource_type, resource_id, level";

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

/** ⚠ Insert only where no grant exists yet — never downgrades. */
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

/**
 * Resource ids per batched grant statement.
 * ⚠ The bound is the REQUEST, not the DB: PostgREST `.in()` serialises into
 * the URL and uuids run ~40 bytes each, so an unchunked delete over a big
 * folder 414s at the gateway. 100 ids ≈ 4KB, half the smallest limit in the
 * path. The upsert chunk is in ROWS because its payload is the body
 * (resourceIds × teamIds).
 */
const GRANT_ID_CHUNK = 100;
const GRANT_ROW_CHUNK = 500;

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

/** Set form of `deleteGrantsForResource`, for replace-set propagation (a
 *  folder re-scope rewrites every filed chat's grants). One statement per
 *  chunk, not per resource. */
export async function deleteGrantsForResources(
  workspaceId: string,
  resourceType: TeamResourceType,
  resourceIds: string[]
): Promise<void> {
  if (resourceIds.length === 0) return;
  const db = supabaseAdmin();
  for (const ids of chunk(resourceIds, GRANT_ID_CHUNK)) {
    const { error } = await db
      .from("team_resource_access")
      .delete()
      .eq("workspace_id", workspaceId)
      .eq("resource_type", resourceType)
      .in("resource_id", ids);
    if (error) throw error;
  }
}

/** `insertReadGrantsIfMissing` over resources × teams, one upsert per chunk.
 *  ⚠ Same never-downgrade rule: existing (possibly `write`) grants stand. */
export async function insertReadGrantsForResources(
  workspaceId: string,
  resourceType: TeamResourceType,
  resourceIds: string[],
  teamIds: string[]
): Promise<void> {
  if (resourceIds.length === 0 || teamIds.length === 0) return;
  const rows = resourceIds.flatMap((resourceId) =>
    teamIds.map((teamId) => ({
      team_id: teamId,
      resource_type: resourceType,
      resource_id: resourceId,
      workspace_id: workspaceId,
      level: "read" as AccessLevel,
    }))
  );
  const db = supabaseAdmin();
  for (const batch of chunk(rows, GRANT_ROW_CHUNK)) {
    const { error } = await db
      .from("team_resource_access")
      .upsert(batch, {
        onConflict: "team_id,resource_type,resource_id",
        ignoreDuplicates: true,
      });
    if (error) throw error;
  }
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

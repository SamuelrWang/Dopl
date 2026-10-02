import "server-only";
import { supabaseAdmin } from "@/shared/supabase/admin";
import type { AccessLevel, TeamResourceType } from "../access-levels";
import type { TeamGrant } from "../types";
import { mapTeamGrantRow, type TeamGrantDbRow } from "./dto";

/**
 * Every read and write of the TEAM slice of `resource_grants`. What a grant
 * POINTS AT lives in `repository-resources.ts`. A grant row is only ever
 * (team, resource_type, resource_id, level).
 *
 * ⚠ THE TABLE IS `resource_grants` (Wave B, ruling B4): a team is one value of
 * `scope_type` beside `channel` and `container`.
 *
 * ⚠ The column is `scope_id`; `team_id:scope_id` in the select keeps
 * `dto.ts › TeamGrantDbRow` and every {@link TeamGrant} caller unchanged.
 *
 * 🔒 EVERY STATEMENT PINS `scope_type = 'team'` (via {@link TEAM_SCOPE}).
 * Without it reads answer with a channel's grants and writes land where the
 * knowledge lane reads.
 *
 * ⚠ `created_by` IS LEFT NULL — the safe direction: `enforce_resource_grant()`
 * holds an unattributed row to same-container equality, and a team grant is
 * same-container by construction, so it can never reach a cross-container lend.
 *
 * ⚠ Every query not pinned to a single team is filtered by `workspace_id`.
 */

const GRANTS_TABLE = "resource_grants";

/** The slice this module owns, as an equality filter set for `.match()`. */
const TEAM_SCOPE = { scope_type: "team" } as const;

const GRANT_COLS = "team_id:scope_id, resource_type, resource_id, level";

/** The row a write states, minus the key columns each caller supplies. */
function grantRow(
  workspaceId: string,
  teamId: string,
  resourceType: TeamResourceType,
  resourceId: string,
  level: AccessLevel
) {
  return {
    ...TEAM_SCOPE,
    scope_id: teamId,
    resource_type: resourceType,
    resource_id: resourceId,
    workspace_id: workspaceId,
    level,
  };
}

/** "One grant per (scope, resource)" IS the primary key; this names it. */
const ON_GRANT_PK = "scope_type,scope_id,resource_type,resource_id";

export async function listGrantsForTeam(teamId: string): Promise<TeamGrant[]> {
  const db = supabaseAdmin();
  const { data, error } = await db
    .from(GRANTS_TABLE)
    .select(GRANT_COLS)
    .match({ scope_id: teamId, ...TEAM_SCOPE });
  if (error) throw error;
  return ((data ?? []) as unknown as TeamGrantDbRow[]).map(mapTeamGrantRow);
}

/** All grants in the workspace, optionally narrowed to a set of teams. */
export async function listGrantsForTeams(
  workspaceId: string,
  teamIds?: string[]
): Promise<TeamGrant[]> {
  if (teamIds && teamIds.length === 0) return [];
  const db = supabaseAdmin();
  let query = db
    .from(GRANTS_TABLE)
    .select(GRANT_COLS)
    .match({ workspace_id: workspaceId, ...TEAM_SCOPE });
  if (teamIds) query = query.in("scope_id", teamIds);
  const { data, error } = await query;
  if (error) throw error;
  return ((data ?? []) as unknown as TeamGrantDbRow[]).map(mapTeamGrantRow);
}

export async function listGrantsForResource(
  workspaceId: string,
  resourceType: TeamResourceType,
  resourceId: string
): Promise<TeamGrant[]> {
  const db = supabaseAdmin();
  const { data, error } = await db
    .from(GRANTS_TABLE)
    .select(GRANT_COLS)
    .match({
      workspace_id: workspaceId,
      resource_type: resourceType,
      resource_id: resourceId,
      ...TEAM_SCOPE,
    });
  if (error) throw error;
  return ((data ?? []) as unknown as TeamGrantDbRow[]).map(mapTeamGrantRow);
}

export async function upsertGrant(
  workspaceId: string,
  teamId: string,
  resourceType: TeamResourceType,
  resourceId: string,
  level: AccessLevel
): Promise<void> {
  const db = supabaseAdmin();
  const { error } = await db.from(GRANTS_TABLE).upsert(
    {
      ...grantRow(workspaceId, teamId, resourceType, resourceId, level),
      updated_at: new Date().toISOString(),
    },
    { onConflict: ON_GRANT_PK }
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
  const { error } = await db.from(GRANTS_TABLE).upsert(
    teamIds.map((teamId) =>
      grantRow(workspaceId, teamId, resourceType, resourceId, "read")
    ),
    { onConflict: ON_GRANT_PK, ignoreDuplicates: true }
  );
  if (error) throw error;
}

/**
 * ⚠ The bound is the REQUEST URL, not the DB: `.in()` serialises uuids into
 * the URL, so an unchunked delete over a big folder 414s. 100 ids ≈ 4KB. The
 * upsert chunk is in ROWS because its payload is the body.
 */
const GRANT_ID_CHUNK = 100;
const GRANT_ROW_CHUNK = 500;

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

/** Set form of `deleteGrantsForResource` (folder re-scope rewrites every filed
 *  chat's grants). One statement per chunk. */
export async function deleteGrantsForResources(
  workspaceId: string,
  resourceType: TeamResourceType,
  resourceIds: string[]
): Promise<void> {
  if (resourceIds.length === 0) return;
  const db = supabaseAdmin();
  for (const ids of chunk(resourceIds, GRANT_ID_CHUNK)) {
    const { error } = await db
      .from(GRANTS_TABLE)
      .delete()
      .match({
        workspace_id: workspaceId,
        resource_type: resourceType,
        ...TEAM_SCOPE,
      })
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
    teamIds.map((teamId) =>
      grantRow(workspaceId, teamId, resourceType, resourceId, "read")
    )
  );
  const db = supabaseAdmin();
  for (const batch of chunk(rows, GRANT_ROW_CHUNK)) {
    const { error } = await db
      .from(GRANTS_TABLE)
      .upsert(batch, { onConflict: ON_GRANT_PK, ignoreDuplicates: true });
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
    .from(GRANTS_TABLE)
    .select(GRANT_COLS)
    .match({
      workspace_id: workspaceId,
      resource_type: resourceType,
      ...TEAM_SCOPE,
    })
    .in("resource_id", resourceIds);
  if (error) throw error;
  return ((data ?? []) as unknown as TeamGrantDbRow[]).map(mapTeamGrantRow);
}

/** Drop every team grant on one resource (KB going private). */
export async function deleteGrantsForResource(
  workspaceId: string,
  resourceType: TeamResourceType,
  resourceId: string
): Promise<void> {
  const db = supabaseAdmin();
  const { error } = await db
    .from(GRANTS_TABLE)
    .delete()
    .match({
      workspace_id: workspaceId,
      resource_type: resourceType,
      resource_id: resourceId,
      ...TEAM_SCOPE,
    });
  if (error) throw error;
}

export async function deleteGrantRow(
  teamId: string,
  resourceType: TeamResourceType,
  resourceId: string
): Promise<void> {
  const db = supabaseAdmin();
  const { error } = await db
    .from(GRANTS_TABLE)
    .delete()
    .match({
      scope_id: teamId,
      resource_type: resourceType,
      resource_id: resourceId,
      ...TEAM_SCOPE,
    });
  if (error) throw error;
}

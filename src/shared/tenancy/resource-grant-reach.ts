import "server-only";
import { supabaseAdmin } from "@/shared/supabase/admin";
import { meetsMinRole, type Role } from "@/features/workspaces/types";
import { channelsWhereScopeIsIgnored } from "./channel-scope";

/**
 * The read half of a grant: which rows are lent to a scope the caller is in, decided only here (F-604).
 * One rule written twice (INVARIANTS §5A): the SQL twin is `dopl_grant_admits(text, uuid)`, called by
 * `dopl_knowledge_base_readable()` and `can_current_user_read_agent_identity()`; move them together.
 * Levels are not one ladder: a `container` grant (`read | edit`) always admits reading; a `channel`
 * grant admits a person only at `visible` — `agent_only` must not widen a human's read.
 * A channel-scoped row whose channel sits in a `kind='standard'` container is ignored
 * (`./channel-scope.ts`); old rows may still exist, so this cannot assume a clean table.
 * `team` scope is not answered by {@link grantedResourceIds}: `dopl_teams_mode_visible()` /
 * `filterTeamVisibleBases` own it. {@link teamGrantedResourceIds} is a batched membership door for
 * cross-container search, not a second copy of that rule (F-716).
 * Widens visibility, never a list's candidate set: a row lent across containers resolves by id
 * (`resolve-resource.ts › findGrantedResource`) but is not listed (F-662).
 */

/** Mirrors `resource_grants.resource_type`. */
export type GrantResourceType =
  | "knowledge_base"
  | "agent_identity"
  | "skill"
  | "chat"
  | "chat_folder";

/** A set, so the `canSee*` predicates that take it stay synchronous. */
export type GrantedResourceIds = ReadonlySet<string>;

/** Shared by every no-grant path, so the hot list path allocates nothing. */
export const NO_GRANTS: GrantedResourceIds = new Set<string>();

/** Ceiling on a `resource_grants` fan-out, shared with `knowledge/server/repository-audience.ts` so
 *  both grant lanes truncate at the same point. PostgREST truncates silently, in the safe direction. */
export const GRANT_REACH_LIMIT = 500;

/** Same floor as every read; `guest` ranks below it. */
const CONTAINER_READ_FLOOR: Role = "viewer";

interface GrantRow {
  scope_type: "channel" | "container";
  scope_id: string;
  resource_id: string;
  level: string;
}

/**
 * Which of `resourceIds` are lent to a channel or container the caller is in. A batch precompute, never
 * a query per row: at most five queries, none when `resourceIds` is empty (an empty `.in()` is a
 * PostgREST hazard) or nothing is granted.
 * Not filtered by the caller's container: a grant is filed under the resource's container but reached
 * through the scope's, so a `workspace_id` term would refuse exactly the grants this honours.
 */
export async function grantedResourceIds(
  userId: string,
  resourceType: GrantResourceType,
  resourceIds: readonly string[]
): Promise<GrantedResourceIds> {
  if (resourceIds.length === 0) return NO_GRANTS;
  const db = supabaseAdmin();
  const { data, error } = await db
    .from("resource_grants")
    .select("scope_type, scope_id, resource_id, level")
    .eq("resource_type", resourceType)
    .in("resource_id", [...new Set(resourceIds)])
    .in("scope_type", ["channel", "container"])
    .limit(GRANT_REACH_LIMIT);
  if (error) throw error;
  const rows = (data ?? []) as unknown as GrantRow[];
  // Before the membership reads, so an `agent_only` channel grant never causes (or widens via) a lookup.
  const admitting = rows.filter(
    (r) => r.scope_type === "container" || r.level === "visible"
  );
  if (admitting.length === 0) return NO_GRANTS;

  const scopeIds = (kind: GrantRow["scope_type"]) => [
    ...new Set(admitting.filter((r) => r.scope_type === kind).map((r) => r.scope_id)),
  ];
  const [containers, channels, ignoredChannels] = await Promise.all([
    reachableContainers(db, userId, scopeIds("container")),
    reachableChannels(db, userId, scopeIds("channel")),
    // A channel-scoped row in a standard workspace widens nobody's read.
    channelsWhereScopeIsIgnored(scopeIds("channel")),
  ]);

  const granted = new Set<string>();
  for (const row of admitting) {
    const reached =
      row.scope_type === "container"
        ? containers.has(row.scope_id)
        : channels.has(row.scope_id) && !ignoredChannels.has(row.scope_id);
    if (reached) granted.add(row.resource_id);
  }
  return granted.size === 0 ? NO_GRANTS : granted;
}

/** `status='active'` and the role floor, both: a removed member is not one, and `guest` stays out. */
async function reachableContainers(
  db: ReturnType<typeof supabaseAdmin>,
  userId: string,
  containerIds: string[]
): Promise<Set<string>> {
  if (containerIds.length === 0) return new Set();
  const { data, error } = await db
    .from("workspace_members")
    .select("workspace_id, role")
    .eq("user_id", userId)
    .eq("status", "active")
    .in("workspace_id", containerIds);
  if (error) throw error;
  const rows = (data ?? []) as unknown as Array<{
    workspace_id: string;
    role: Role;
  }>;
  return new Set(
    rows
      .filter((r) => meetsMinRole(r.role, CONTAINER_READ_FLOOR))
      .map((r) => r.workspace_id)
  );
}

/** `channel_members` has no status or rank: presence is membership, as in `is_channel_member()`. */
async function reachableChannels(
  db: ReturnType<typeof supabaseAdmin>,
  userId: string,
  channelIds: string[]
): Promise<Set<string>> {
  if (channelIds.length === 0) return new Set();
  const { data, error } = await db
    .from("channel_members")
    .select("channel_id")
    .eq("user_id", userId)
    .in("channel_id", channelIds);
  if (error) throw error;
  return new Set(
    ((data ?? []) as unknown as Array<{ channel_id: string }>).map(
      (r) => r.channel_id
    )
  );
}

/**
 * Which of `resourceIds` are lent to a team the caller is in, batched across containers (F-716).
 * Answers membership, never visibility: each feature's `canSee*` takes the set and decides.
 * No `workspace_id` term — the fence is the input: pass only ids a membership read produced
 * (`search/server/repository-reach.ts`).
 */
export async function teamGrantedResourceIds(
  userId: string,
  resourceType: GrantResourceType,
  resourceIds: readonly string[]
): Promise<GrantedResourceIds> {
  if (resourceIds.length === 0) return NO_GRANTS;
  const db = supabaseAdmin();
  const { data: teamRows, error: teamError } = await db
    .from("team_members")
    .select("team_id")
    .eq("user_id", userId)
    .limit(GRANT_REACH_LIMIT);
  if (teamError) throw teamError;
  const teamIds = [
    ...new Set(
      ((teamRows ?? []) as Array<{ team_id: string }>).map((r) => r.team_id)
    ),
  ];
  if (teamIds.length === 0) return NO_GRANTS;

  const { data, error } = await db
    .from("resource_grants")
    .select("resource_id")
    .eq("resource_type", resourceType)
    .eq("scope_type", "team")
    .in("scope_id", teamIds)
    .in("resource_id", [...new Set(resourceIds)])
    .limit(GRANT_REACH_LIMIT);
  if (error) throw error;
  const granted = new Set(
    ((data ?? []) as Array<{ resource_id: string }>).map((r) => r.resource_id)
  );
  return granted.size === 0 ? NO_GRANTS : granted;
}

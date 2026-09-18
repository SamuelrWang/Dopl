import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
// One ceiling for both `resource_grants` fan-outs — this read and
// `grantedResourceIds`. Two copies of one number stop being one number.
import { GRANT_REACH_LIMIT } from "@/shared/tenancy/resource-grant-reach";

/**
 * Raw Supabase I/O for the AGENT AUDIENCE CEILING (`service-audience.ts`). Four
 * reads, no business logic: the workspace's kind, its active member count, its
 * channel ids, and the knowledge-base ids granted onto those channels.
 *
 * Every input to the ceiling is a DB fact read here: the ceiling may not be
 * decided by anything the caller can type (`X-Workspace-Id`, `X-Dopl-Runtime`
 * and `X-Dopl-Session-Id` are documented NON-authorization signals, §10). The
 * workspace id has already been proved a MEMBERSHIP by `withWorkspaceAuth`;
 * everything else about it is re-read from the database.
 *
 * Takes a `SupabaseClient` rather than reaching for `supabaseAdmin()` itself
 * (§2): the service passes the service-role client, which BYPASSES RLS, so every
 * method here filters by `workspace_id` explicitly. Passing the client also lets
 * tests drive a fake with no module mock.
 */

/**
 * `workspaces.kind` for one workspace, or `null` when the row is gone.
 *
 * Returns the RAW column, not a predicate. `workspaces/types.ts ›
 * isStandardWorkspace` is the LISTING predicate (§4A/F-295); the ceiling asks
 * the opposite question — "is this specifically a link container" — and must
 * answer NO for an unknown future kind. Keeping the raw value states that choice
 * in the service rather than inheriting it from the other direction's helper.
 */
export async function findWorkspaceKind(
  db: SupabaseClient,
  workspaceId: string
): Promise<string | null> {
  const { data, error } = await db
    .from("workspaces")
    .select("kind")
    .eq("id", workspaceId)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;
  return (data as { kind: string | null }).kind ?? null;
}

/**
 * How many ACTIVE members the workspace has — the solo/shared question, and the
 * only thing separating "today's behaviour" from a narrowed audience.
 *
 * `status='active'` is the filter, matching every other member count: an
 * invited-but-unaccepted row is not a peer in the room, and counting one would
 * narrow a solo operator's own agent for a person who never arrived.
 *
 * The only threshold read off this number is solo-vs-not (`<= 1` in
 * `service-audience.ts`), and it must stay that way — a container has no member
 * cap (INVARIANTS §4A), so a comparison against any fixed number would invent a
 * limit the server does not have.
 *
 * `head: true` + `count: "exact"`: only the number is needed. A `null` count is
 * reported as-is and the SERVICE decides what silence means.
 */
export async function countActiveWorkspaceMembers(
  db: SupabaseClient,
  workspaceId: string
): Promise<number | null> {
  const { count, error } = await db
    .from("workspace_members")
    .select("user_id", { count: "exact", head: true })
    .eq("workspace_id", workspaceId)
    .eq("status", "active");
  if (error) throw error;
  return count ?? null;
}

/**
 * Ceiling on the container's channel fan. A link container holds ONE channel by
 * design (§4A) and F-327 says nothing enforces it, so this is sized for the
 * unenforced case and not for a workspace-sized room list.
 *
 * Same reason as `CHANNEL_GRANT_LIMIT`: PostgREST truncates an un-limited select
 * SILENTLY. Truncation here fails safe (fewer grants reachable) but invisibly,
 * and a fence that narrows for reasons nobody can see is one nobody can debug.
 */
export const CONTAINER_CHANNEL_LIMIT = 200;

/**
 * Every channel id in the workspace — the SET the ceiling is built on (§4.3).
 *
 * Not narrowed by membership, deliberately: the question is "which rooms belong
 * to this container", not "which rooms may this user see". The one that matters
 * — the grant row — is applied on top of this set either way.
 */
export async function listChannelIdsForWorkspace(
  db: SupabaseClient,
  workspaceId: string
): Promise<string[]> {
  const { data, error } = await db
    .from("channels")
    .select("id")
    .eq("workspace_id", workspaceId)
    .limit(CONTAINER_CHANNEL_LIMIT);
  if (error) throw error;
  return ((data ?? []) as { id: string }[]).map((r) => r.id);
}

/**
 * The DISTINCT knowledge-base ids granted onto ANY of `channelIds`, AT EITHER
 * LEVEL — the reachable set behind {@link resolveAgentAudience}.
 *
 * Both levels count here, unlike the guest lane: `agent_only` means "my agent
 * may read this in this room", so on the AGENT's own audience it is a grant like
 * any other, and `visible` is strictly more. The guest lane filters to `visible`
 * in SQL for the inverse reason (`listChannelGrantsAtLevel`).
 *
 * Empty `channelIds` short-circuits with NO query and an empty set — fail-closed,
 * and a PostgREST `.in()` on an empty array is a syntax hazard anyway.
 *
 * The slice of `resource_grants` is pinned on BOTH halves — `scope_type='channel'`
 * beside `resource_type='knowledge_base'` — for the reason
 * `repository-channel-grants.ts › CHANNEL_KNOWLEDGE_GRANT` states: without the
 * scope term this read would count a TEAM's grants as a channel's (F-460).
 *
 * There is no `workspace_id` term (F-662): a grant row is filed under the
 * RESOURCE's container while the caller reaches it through the SCOPE's, so such
 * a term refused precisely the cross-container lend a grant exists to be.
 * `dopl_grant_admits()` has none either, and
 * `resource-grant-reach.ts › grantedResourceIds` dropped it for the same reason.
 * `channelIds` is the fence and always was — the caller passes the channels of
 * the container it is acting in (`service-audience.ts ›
 * listChannelIdsForWorkspace`, then the session narrowing), so the tenancy is
 * stated by the scope.
 */
export async function listGrantedBaseIdsForChannels(
  db: SupabaseClient,
  channelIds: string[]
): Promise<string[]> {
  if (channelIds.length === 0) return [];
  const { data, error } = await db
    .from("resource_grants")
    .select("resource_id")
    .eq("scope_type", "channel")
    .eq("resource_type", "knowledge_base")
    .in("scope_id", channelIds)
    .limit(GRANT_REACH_LIMIT);
  if (error) throw error;
  return [
    ...new Set(((data ?? []) as { resource_id: string }[]).map((r) => r.resource_id)),
  ];
}

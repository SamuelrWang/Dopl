import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Raw Supabase I/O for the AGENT AUDIENCE CEILING (`service-audience.ts`). Four
 * reads, no business logic: the workspace's kind, its active member count, its
 * channel ids, and the knowledge-base ids granted onto those channels.
 *
 * 🔒 EVERY INPUT TO THE CEILING IS A DB FACT READ HERE, ON THE SERVICE CLIENT.
 * That is the whole point of the layer: the ceiling may not be decided by
 * anything the caller can type. `X-Workspace-Id`, `X-Dopl-Runtime` and
 * `X-Dopl-Session-Id` are documented NON-authorization signals (§10), and an
 * agent holding a 90-day device token can send any value for all three. The
 * workspace id these functions take has already been proved a MEMBERSHIP by
 * `withWorkspaceAuth`; everything else about it is re-read from the database
 * rather than carried in on the request.
 *
 * ⚠ TAKES A `SupabaseClient` rather than reaching for `supabaseAdmin()` itself
 * (§2, and the discipline `repository-channel-grants.ts` states): the service
 * passes the service-role client, which BYPASSES RLS, so every method here
 * filters by `workspace_id` EXPLICITLY. Passing the client also lets tests drive
 * a fake with no module mock.
 */

/**
 * `workspaces.kind` for one workspace, or `null` when the row is gone.
 *
 * ⚠ RETURNS THE RAW COLUMN, NOT A PREDICATE. `workspaces/types.ts ›
 * isStandardWorkspace` is the LISTING predicate and its positive spelling
 * (`(kind ?? "standard") === "standard"`, §4A/F-295) is correct for deciding
 * what a rail shows. The ceiling asks the opposite question — "is this
 * specifically a link container" — and must answer NO for an unknown future
 * kind, because narrowing a workspace nobody has designed yet is a guess.
 * Keeping the raw value here means the service states that choice in one place
 * instead of inheriting it from a helper written for the other direction.
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
 * ⚠ `status='active'` IS THE FILTER, matching every other member count in the
 * system (`assertMemberAddable`'s workspace cap). An invited-but-unaccepted row
 * is not a peer in the room, and counting one would narrow a solo operator's own
 * agent for a person who never arrived.
 *
 * ⚠ **THE ONLY THRESHOLD READ OFF THIS NUMBER IS SOLO-vs-NOT** (`<= 1` in
 * `service-audience.ts`), and it must stay that way. A CONTAINER HAS NO MEMBER
 * CAP since 2026-08-26 (`20260830120000_link_container_multi_member.sql` dropped
 * `enforce_link_container_member_cap`; INVARIANTS §4A: "do not re-derive a cap
 * from a roster length in any layer"), so this count is unbounded above and a
 * second comparison against any fixed number would be inventing a limit the
 * server does not have.
 *
 * ⚠ `head: true` + `count: "exact"` — the rows are never needed, only the
 * number, so an unbounded roster costs nothing to count. A `null` count
 * (PostgREST answering without one) is returned as `0` by the caller's own
 * fail-closed reading, NOT here: this function reports what the database said
 * and lets the service decide what silence means.
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
 * ⚠ Same reason as `CHANNEL_GRANT_LIMIT`: PostgREST truncates an un-limited
 * select SILENTLY. A silent truncation here would DROP channels out of the
 * fenced set, which fails in the SAFE direction (fewer grants reachable) — but
 * it would do it invisibly, and a fence that narrows for reasons nobody can see
 * is one nobody can debug.
 */
export const CONTAINER_CHANNEL_LIMIT = 200;

/**
 * Every channel id in the workspace — the SET the ceiling is built on (§4.3).
 *
 * ⚠ NOT NARROWED BY MEMBERSHIP, and that is deliberate. The caller is the
 * OPERATOR's own agent acting inside its operator's container; the question
 * this answers is "which rooms belong to this container", not "which rooms may
 * this user see". Narrowing it by membership would make the ceiling depend on a
 * second authorization story, and the one that matters — the grant row — is
 * applied on top of this set either way.
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
 * Ceiling on the reachable-base set. Deliberately the same number as
 * `CHANNEL_GRANT_LIMIT` for the same reason, and generous relative to it
 * because this read spans every channel in the container rather than one.
 */
export const AUDIENCE_GRANT_LIMIT = 500;

/**
 * The DISTINCT knowledge-base ids granted onto ANY of `channelIds`, AT EITHER
 * LEVEL — the reachable set behind {@link resolveAgentAudience}.
 *
 * ⚠ BOTH LEVELS COUNT HERE, and that is the difference between this read and
 * the guest lane's. `agent_only` means "my agent may read this in this room",
 * so on the AGENT's own audience it is a grant like any other; `visible` means
 * "and the person in the room may read it too", which is strictly more. The
 * guest lane filters to `visible` in SQL for exactly the inverse reason
 * (`listChannelGrantsAtLevel`). Two lanes, two audiences, one table.
 *
 * ⚠ Empty `channelIds` short-circuits with NO QUERY and an empty set — which
 * fences the agent out of every base, the fail-closed direction. A PostgREST
 * `.in()` on an empty array is a syntax hazard, and "no channels" is a real
 * state (a container mid-creation), not an error.
 *
 * ⚠ THE TABLE IS `resource_grants` SINCE 2026-09-02 (F-460, wave B batch 3).
 * This was the LAST reader of `channel_resource_grants`, which is why that table,
 * its mirror trigger and its enforcement trigger could only be dropped once this
 * statement moved (`20260923130000_drop_channel_resource_grants.sql`). The slice
 * of the one table is pinned on BOTH halves — `scope_type='channel'` beside
 * `resource_type='knowledge_base'` — for the reason
 * `repository-channel-grants.ts › CHANNEL_KNOWLEDGE_GRANT` states: without the
 * scope term this read would count a TEAM's grants as a channel's and widen the
 * ceiling it exists to impose.
 */
export async function listGrantedBaseIdsForChannels(
  db: SupabaseClient,
  workspaceId: string,
  channelIds: string[]
): Promise<string[]> {
  if (channelIds.length === 0) return [];
  const { data, error } = await db
    .from("resource_grants")
    .select("resource_id")
    .eq("workspace_id", workspaceId)
    .eq("scope_type", "channel")
    .eq("resource_type", "knowledge_base")
    .in("scope_id", channelIds)
    .limit(AUDIENCE_GRANT_LIMIT);
  if (error) throw error;
  return [
    ...new Set(((data ?? []) as { resource_id: string }[]).map((r) => r.resource_id)),
  ];
}

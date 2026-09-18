import "server-only";
import { supabaseAdmin } from "@/shared/supabase/admin";
import type { Role, WorkspaceKind } from "@/features/workspaces/types";

/**
 * The proof of access for every search query: read once per request, and the only
 * legitimate source of an id any other search read is handed.
 *
 * Two predicates — `workspace_members.user_id = <caller> AND status = 'active'`
 * by container, `channel_members.user_id = <caller>` by channel. Every downstream
 * read turns an array built here into its own `WHERE … IN (…)`, so a container or
 * channel the caller does not belong to is never named.
 *
 * Membership, deliberately not visibility: a `public` channel admits a non-member
 * to read it (INVARIANTS §5) and this does not. Fewer rows can never be a leak.
 *
 * Every function uses the RLS-bypassing admin client (INVARIANTS §2), so the
 * service IS the fence — never build one of these arrays from caller input.
 *
 * The two membership tables are read here rather than imported across features
 * (§1); it is three columns of two tables.
 */

/** One channel the caller belongs to, with the two labels a cross-container
 *  result row needs: what to call it and which container it lives in. */
export interface SearchChannelRef {
  id: string;
  name: string;
  workspaceId: string;
}

/** One container the caller belongs to. `kind` decides whether the
 *  members/skills/chats groups exist at all (`contracts.ts`). */
export interface SearchContainerRef {
  id: string;
  name: string;
  kind: WorkspaceKind;
  /**
   * F-716 (2026-09-17): the caller's role in THIS container, off the membership
   * row that proved the reach. It rides the ref rather than the request because a
   * single field would answer "an admin somewhere" and admit a row in a container
   * where the caller is a viewer.
   */
  role: Role;
}

/** Everything a search may name. Built once, passed down, never re-derived. */
export interface SearchReach {
  containers: SearchContainerRef[];
  channels: SearchChannelRef[];
}

/**
 * A ceiling, so PostgREST's silent truncation becomes a bounded one. Bounds a
 * pathological account rather than clipping a real one.
 * A clipped reach is NOT reported as a clipped group (INVARIANTS §9): the two are
 * different claims, and under-counting beats lying about a specific group.
 */
export const SEARCH_REACH_LIMIT = 500;

/**
 * The caller's whole reach, in three queries for any number of containers.
 * `containerId` narrows to one container and requires active membership of it —
 * proved by the same `workspace_members` read, never by trusting the parameter.
 *
 * `lockedWorkspaceId` is `ctx.apiKeyWorkspaceId`, never a request field
 * (INVARIANTS §4/§10, R3). Absent means every container the caller is in; set
 * means that one, and the narrowing is total because no downstream query is
 * handed an id from anywhere else. This route is `withUserAuth`, so nothing
 * upstream applies the lock.
 */
export async function loadSearchReach(
  userId: string,
  opts: { lockedWorkspaceId?: string | null; containerId?: string | null } = {}
): Promise<SearchReach> {
  const db = supabaseAdmin();

  let memberQuery = db
    .from("workspace_members")
    .select("workspace_id, role")
    .eq("user_id", userId)
    // `status='active'` — without it a revoked admin still measures as one.
    .eq("status", "active");
  if (opts.lockedWorkspaceId) {
    memberQuery = memberQuery.eq("workspace_id", opts.lockedWorkspaceId);
  }
  if (opts.containerId) {
    // The membership proof for `scope=container`. Narrowing the PROOF rather than
    // filtering its output makes "not a member" and "no such container" the same
    // empty answer, and cannot be forgotten by a downstream caller.
    memberQuery = memberQuery.eq("workspace_id", opts.containerId);
  }
  const { data: memberships, error: memberError } = await memberQuery
    // Ordered because it is limited: an un-ordered `.limit` takes an arbitrary
    // page, so a clipped account would search a different set per keystroke.
    .order("workspace_id", { ascending: true })
    .limit(SEARCH_REACH_LIMIT);
  if (memberError) throw memberError;
  const memberRows = (memberships ?? []) as Array<{
    workspace_id: string;
    role: Role | null;
  }>;
  const containerIds = memberRows.map((r) => r.workspace_id);
  if (containerIds.length === 0) return { containers: [], channels: [] };
  // Absent role reads as `guest` — rank 0, and `defaultLevelForRole("guest")` is
  // `null` where `viewer`'s is `read`. This said `viewer` and CALLED it the
  // least-privileged value (2026-09-17): a narrowed projection would have been
  // granted read rather than nothing.
  const roleById = new Map(
    memberRows.map((r) => [r.workspace_id, (r.role ?? "guest") as Role])
  );

  const { data: workspaceRows, error: workspaceError } = await db
    .from("workspaces")
    .select("id, name, kind")
    .in("id", containerIds)
    .limit(SEARCH_REACH_LIMIT);
  if (workspaceError) throw workspaceError;
  const containers = (
    (workspaceRows ?? []) as Array<{
      id: string;
      name: string;
      kind: WorkspaceKind | null;
    }>
  ).map((row) => ({
    id: row.id,
    name: row.name,
    // ⚠ Absent `kind` reads as standard per `isStandardWorkspace` (INVARIANTS
    // §4A) — but in THIS feature `standard` is the PERMISSIVE side: it unlocks
    // the three container-only groups. Unreachable (`workspaces.kind` is NOT NULL
    // and named in the select), so the fallback is polarity debt, not a hole —
    // F-729.
    kind: (row.kind ?? "standard") as WorkspaceKind,
    role: roleById.get(row.id) ?? ("guest" as Role),
  }));

  return { containers, channels: await loadChannelReach(userId, containerIds) };
}

/**
 * Every live channel the caller is a member of, inside `containerIds`.
 *
 * `deleted_at IS NULL` is not optional: a tombstoned channel is not-found to
 * every other read, and a `channel_members` row outlives the stamp.
 * Archived channels are kept — archive is a sidebar state, not a revocation.
 * Tenancy comes off the membership row's denormalised `workspace_id`, so no
 * second join decides which container a hit belongs to.
 */
async function loadChannelReach(
  userId: string,
  containerIds: string[]
): Promise<SearchChannelRef[]> {
  const db = supabaseAdmin();
  const { data: memberships, error: memberError } = await db
    .from("channel_members")
    .select("channel_id, workspace_id")
    .eq("user_id", userId)
    // The second half of the lock: without it a container-locked credential would
    // search every room its operator is in.
    .in("workspace_id", containerIds)
    .order("channel_id", { ascending: true })
    .limit(SEARCH_REACH_LIMIT);
  if (memberError) throw memberError;
  const rows = (memberships ?? []) as Array<{
    channel_id: string;
    workspace_id: string;
  }>;
  if (rows.length === 0) return [];
  const workspaceByChannel = new Map(
    rows.map((r) => [r.channel_id, r.workspace_id])
  );

  const { data, error } = await db
    .from("channels")
    .select("id, name")
    .is("deleted_at", null)
    .in("id", [...workspaceByChannel.keys()])
    .limit(SEARCH_REACH_LIMIT);
  if (error) throw error;
  return ((data ?? []) as Array<{ id: string; name: string }>).map((c) => ({
    id: c.id,
    name: c.name,
    // Non-null by construction — the id set came from this very map.
    workspaceId: workspaceByChannel.get(c.id) as string,
  }));
}

import "server-only";
import { supabaseAdmin } from "@/shared/supabase/admin";
import type { Role, WorkspaceKind } from "@/features/workspaces/types";

/**
 * 🔒 **THE PROOF OF ACCESS FOR EVERY SEARCH QUERY — one module, read once per
 * request, and the ONLY legitimate source of an id any other search read is
 * handed** (2026-09-17).
 *
 * ── THE FENCE, AND IT IS TWO PREDICATES ────────────────────────────────────
 *
 * **`workspace_members.user_id = <caller> AND status = 'active'`** for anything
 * addressed by container, and **`channel_members.user_id = <caller>`** for
 * anything addressed by channel. Every read in
 * `repository-channel-rows.ts` / `repository-container-rows.ts` takes an id
 * ARRAY built here and turns it into its own `WHERE … IN (…)`, so a container or
 * a channel the caller does not belong to is never NAMED by a query — exactly
 * the shape `channels/server/repository-account.ts` states for the account-wide
 * channel reads, and for the same reason.
 *
 * ⚠ **MEMBERSHIP, DELIBERATELY NOT VISIBILITY.** A `public` channel admits a
 * non-member to READ it (INVARIANTS §5) and this does not: a search popup
 * filling with rooms nobody invited the caller into is the same complaint
 * `listMemberChannelRefs` records. **Fewer rows can never be a leak.**
 *
 * ⚠ **EVERY FUNCTION USES THE RLS-BYPASSING ADMIN CLIENT** (`RLS_CALLER_SCOPED_
 * READS` is off, INVARIANTS §2), so the service IS the fence and RLS is not a
 * backstop. Never build one of these arrays from anything a caller sent.
 *
 * ⚠ `workspace_members` and `channel_members` are read HERE rather than imported
 * from `features/workspaces` / `features/channels`: §1 forbids the cross-feature
 * import and this is three columns of two tables — the same trade
 * `shared/tenancy/resolve-resource.ts › containerRoles` makes, in its own words.
 */

/** One channel the caller belongs to, with the two labels a cross-container
 *  result row needs: what to CALL it and which container it lives in. */
export interface SearchChannelRef {
  id: string;
  name: string;
  workspaceId: string;
}

/** One container the caller belongs to. ⚠ `kind` decides whether the
 *  members/skills/chats groups exist at all (`contracts.ts`). */
export interface SearchContainerRef {
  id: string;
  name: string;
  kind: WorkspaceKind;
  /**
   * 🔒 THE CALLER'S OWN ROLE IN THIS CONTAINER, off the membership row that
   * proved the reach (F-716, 2026-09-17). The workspace-admin arm of
   * `skills › canSeeSkill` and `agent-templates › canSeeTemplate` needs it, and
   * account scope spans many containers — so it rides the ref rather than being
   * a field on the request, which would answer "an admin somewhere" and admit a
   * row in a container where the caller is a viewer.
   */
  role: Role;
}

/** Everything a search may name. ⚠ Built once; passed down; never re-derived. */
export interface SearchReach {
  containers: SearchContainerRef[];
  channels: SearchChannelRef[];
}

/**
 * ⚠ A ceiling, so PostgREST's silent truncation becomes a bounded one. Both are
 * `channels/server/repository-account.ts › ACCOUNT_CHANNEL_LIMIT`'s number, for
 * its reason: an account's container and channel counts are small, and this
 * exists to bound a pathological account rather than to clip a real one.
 * ⚠ A clipped REACH is NOT reported as a clipped group — the two are different
 * claims (INVARIANTS §9) and a search that scanned fewer rooms than it should
 * have under-counts rather than lying about a specific group.
 */
export const SEARCH_REACH_LIMIT = 500;

/**
 * 🔒 The caller's whole reach. `containerId` narrows to ONE container and
 * REQUIRES that the caller be an active member of it — the membership is proved
 * by the same `workspace_members` read, never by trusting the parameter.
 *
 * ⚠ **`lockedWorkspaceId` IS `ctx.apiKeyWorkspaceId`, NEVER A REQUEST FIELD**
 * (INVARIANTS §4/§10, R3). Absent ⇒ every container the caller is in, which is
 * what an ordinary session or device token gets. Set ⇒ that one, and the
 * narrowing is TOTAL because no query downstream is handed an id from anywhere
 * else. This route is `withUserAuth`, so nothing upstream applies the lock —
 * `GET /api/channels/account/status` carries the same paragraph for the same
 * reason.
 *
 * THREE QUERIES, for any number of containers.
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
    // ⚠ `status='active'` — `workspaces/server/repository.ts › findMembership`
    // carries the scar of omitting it (a revoked admin still measured as one).
    .eq("status", "active");
  if (opts.lockedWorkspaceId) {
    memberQuery = memberQuery.eq("workspace_id", opts.lockedWorkspaceId);
  }
  if (opts.containerId) {
    // 🔒 THE MEMBERSHIP PROOF FOR `scope=container`. Narrowing the PROOF rather
    // than filtering its output is what makes "not a member" and "no such
    // container" the same empty answer — a filter downstream is a filter a
    // future caller can forget.
    memberQuery = memberQuery.eq("workspace_id", opts.containerId);
  }
  const { data: memberships, error: memberError } = await memberQuery
    // ⚠ ORDERED, BECAUSE IT IS LIMITED. An un-ordered `.limit` takes an
    // ARBITRARY page, so a clipped account would search a different set of
    // containers on every keystroke.
    .order("workspace_id", { ascending: true })
    .limit(SEARCH_REACH_LIMIT);
  if (memberError) throw memberError;
  const memberRows = (memberships ?? []) as Array<{
    workspace_id: string;
    role: Role | null;
  }>;
  const containerIds = memberRows.map((r) => r.workspace_id);
  if (containerIds.length === 0) return { containers: [], channels: [] };
  // ⚠ ABSENT ROLE = `viewer`, the LEAST-PRIVILEGED reading. A narrowed
  // projection or an older row must not be read as an admin.
  const roleById = new Map(
    memberRows.map((r) => [r.workspace_id, (r.role ?? "viewer") as Role])
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
    // ⚠ Absent `kind` = standard, the one reading `isStandardWorkspace` allows
    // (INVARIANTS §4A): a narrowed projection or an older row omits it.
    kind: (row.kind ?? "standard") as WorkspaceKind,
    role: roleById.get(row.id) ?? ("viewer" as Role),
  }));

  return { containers, channels: await loadChannelReach(userId, containerIds) };
}

/**
 * 🔒 Every LIVE channel the caller is a MEMBER of, inside `containerIds`.
 *
 * ⚠ `deleted_at IS NULL` is not optional: a soft-deleted (tombstoned) channel is
 * NOT-FOUND to every other read and a `channel_members` row outlives the stamp.
 * ⚠ ARCHIVED channels are KEPT — archive is a sidebar state, not a revocation,
 * and a search is exactly where somebody goes to find an archived room.
 * ⚠ The tenancy comes off the MEMBERSHIP row, which carries `workspace_id`
 * denormalised, so no second join decides which container a hit belongs to.
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
    // 🔒 THE SECOND HALF OF THE LOCK. `channel_members.workspace_id` is
    // denormalised precisely so this narrowing needs no join — and without it a
    // container-locked credential would search every room its operator is in.
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
    // ⚠ Non-null by construction — the id set came from this very map.
    workspaceId: workspaceByChannel.get(c.id) as string,
  }));
}

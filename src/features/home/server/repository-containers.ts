import "server-only";
import { generatePublicId } from "@/shared/lib/id/public-id";
import { supabaseAdmin } from "@/shared/supabase/admin";
import type { Role } from "@/features/workspaces/types";
import { LINK_CONTAINER_COLS, type LinkContainerRow } from "./dto";

/**
 * Data access for the CONTAINER half of home channels: the `kind='link'`
 * workspaces, their membership, and the one channel inside each.
 *
 * ⚠ SPLIT OUT OF `repository.ts` (2026-08-24), which keeps the `channel_links`
 * half. One file per reason to change (INVARIANTS §1): links change when the
 * invite mechanics change, containers when the membership shape does — and the
 * channel-first inversion moved only the second. **`repository.ts` re-exports
 * everything here**, so `import * as repo from "./repository"` and the suites'
 * `vi.mock("./repository")` both keep working and no call site moved.
 *
 * Every read selects COLUMNS and carries a limit (§9); nothing here authorizes
 * anything — except `findMemberContainer`, which is a FENCE and says so.
 */

/* ---------------------------- containers ------------------------------ */

/** The caller's link containers, newest first. */
export async function listLinkContainers(
  userId: string,
  limit: number
): Promise<LinkContainerRow[]> {
  const { data, error } = await supabaseAdmin()
    .from("workspace_members")
    .select(`workspace:workspaces!inner(${LINK_CONTAINER_COLS}, kind)`)
    .eq("user_id", userId)
    .eq("status", "active")
    .eq("workspace.kind", "link")
    .limit(limit);
  if (error) throw error;
  // ⚠ Sorted here, not in the query: ordering an EMBEDDED column is the one
  // thing `listWorkspacesForUser` also does client-side, and the ceiling is a
  // safety limit rather than a page.
  return flattenWorkspaces(data).sort((a, b) =>
    a.created_at < b.created_at ? 1 : a.created_at > b.created_at ? -1 : 0
  );
}

/**
 * THE AUTHZ FENCE for every container-scoped write on this surface: one
 * container, only if the caller is an ACTIVE member of it and it really is a
 * `kind='link'` container.
 *
 * ⚠ ABSENT, NOT FORBIDDEN. A non-member reads `null` and the service answers
 * 404, never 403 — the same rule §4's resolver applies to workspaces, and for
 * the same reason: a 403 makes the endpoint an oracle for which container ids
 * exist. It also refuses a STANDARD workspace the caller genuinely belongs to,
 * because "add a person to my home channel" must not be a second, unaudited
 * door into the invitation system.
 */
export async function findMemberContainer(
  workspaceId: string,
  userId: string
): Promise<LinkContainerRow | null> {
  const { data, error } = await supabaseAdmin()
    .from("workspace_members")
    .select(`workspace:workspaces!inner(${LINK_CONTAINER_COLS}, kind)`)
    .eq("workspace_id", workspaceId)
    .eq("user_id", userId)
    .eq("status", "active")
    .eq("workspace.kind", "link")
    .limit(1);
  if (error) throw error;
  return flattenWorkspaces(data)[0] ?? null;
}

/**
 * The pair's existing container, if any.
 *
 * ⚠ ONE query with BOTH memberships joined in, never a dedup over the listed
 * page: `listLinkContainers` is capped, so intersecting its results would miss
 * a pair whose container sits past the cap and mint a SECOND container for a
 * pair that already has one. Two aliased `!inner` embeds of the same table AND
 * together, so the filter is "A is a member and B is a member" evaluated in the
 * database over every row.
 *
 * ⚠ A container may hold ONE member (a solo channel) or MANY (2026-08-26), so
 * this is not "members are exactly {A, B}" — it is "both are in it", which is
 * the question the legacy unbound claim asks and the only one it needs answered.
 * `.limit(1)` keeps it bounded.
 *
 * ⚠ **NOTHING KEEPS A PAIR TO ONE CONTAINER ANY MORE, AND THAT IS FINE HERE.**
 * The two-member cap trigger used to (a second shared container would have
 * needed a second two-person claim); the cap is dropped, so two people may share
 * several containers — which is what "more than two members" implies anyway,
 * since one relationship is no longer one room. This read still answers
 * correctly: it returns SOME container both are in, which is precisely what the
 * legacy unbound branch needs to avoid minting a duplicate.
 */
export async function findPairContainer(
  userIdA: string,
  userIdB: string
): Promise<LinkContainerRow | null> {
  const { data, error } = await supabaseAdmin()
    .from("workspaces")
    .select(
      `${LINK_CONTAINER_COLS}, a:workspace_members!inner(user_id), b:workspace_members!inner(user_id)`
    )
    .eq("kind", "link")
    .eq("a.user_id", userIdA)
    .eq("a.status", "active")
    .eq("b.user_id", userIdB)
    .eq("b.status", "active")
    .limit(1);
  if (error) throw error;
  const row = (data ?? [])[0] as (LinkContainerRow & Record<string, unknown>) | undefined;
  if (!row) return null;
  return {
    id: row.id,
    slug: row.slug,
    public_id: row.public_id,
    created_at: row.created_at,
  };
}

/**
 * Mint a SOLO container — the "New channel" path (2026-08-24). ONE member row,
 * role `owner`: the creator is alone in here on purpose, and a person is added
 * later by claiming a link bound to this workspace.
 *
 * ⚠ Rolls the workspace back if the member insert fails, exactly as
 * `insertLinkContainer` and `workspaces/server/repository.ts ›
 * insertWorkspaceWithOwnerMembership` do — a member-less container is
 * unreachable and invisible, so nothing would ever find it to clean it up.
 */
export async function insertSoloContainer(args: {
  ownerUserId: string;
  name: string;
  slug: string;
}): Promise<LinkContainerRow> {
  const db = supabaseAdmin();
  const { data, error } = await db
    .from("workspaces")
    .insert({
      owner_id: args.ownerUserId,
      name: args.name,
      slug: args.slug,
      public_id: generatePublicId(),
      kind: "link",
    })
    .select(LINK_CONTAINER_COLS)
    .single();
  if (error || !data) throw error || new Error("Failed to create container");
  const container = data as LinkContainerRow;

  const { error: memberError } = await db.from("workspace_members").insert({
    workspace_id: container.id,
    user_id: args.ownerUserId,
    role: "owner",
    status: "active",
    joined_at: new Date().toISOString(),
  });
  if (memberError) {
    await db.from("workspaces").delete().eq("id", container.id);
    throw memberError;
  }
  return container;
}

/**
 * Mint the container for a LEGACY UNBOUND claim: two members at birth. Creator
 * owns it (and the workspace row's `owner_id`); the claimer joins as `admin` so
 * neither side is a guest in their own relationship, and only the creator can
 * delete it.
 *
 * ⚠ STILL LIVE, not dead code. Measured 2026-08-24 the project holds open
 * claimable tokens with `workspace_id IS NULL`, and those URLs are in somebody's
 * chat history (migration 20260824120000's header).
 *
 * ⚠ Rolls the workspace back if either member insert fails — see
 * `insertSoloContainer`.
 */
export async function insertLinkContainer(args: {
  creatorUserId: string;
  claimerUserId: string;
  name: string;
  slug: string;
}): Promise<LinkContainerRow> {
  const db = supabaseAdmin();
  const { data, error } = await db
    .from("workspaces")
    .insert({
      owner_id: args.creatorUserId,
      name: args.name,
      slug: args.slug,
      public_id: generatePublicId(),
      kind: "link",
    })
    .select(LINK_CONTAINER_COLS)
    .single();
  if (error || !data) throw error || new Error("Failed to create container");
  const container = data as LinkContainerRow;

  const joinedAt = new Date().toISOString();
  const { error: memberError } = await db.from("workspace_members").insert([
    {
      workspace_id: container.id,
      user_id: args.creatorUserId,
      role: "owner",
      status: "active",
      joined_at: joinedAt,
    },
    {
      workspace_id: container.id,
      user_id: args.claimerUserId,
      role: "admin",
      status: "active",
      invited_by: args.creatorUserId,
      invited_at: joinedAt,
      joined_at: joinedAt,
    },
  ]);
  if (memberError) {
    await db.from("workspaces").delete().eq("id", container.id);
    throw memberError;
  }
  return container;
}

/**
 * Add the second member to an existing container — the BOUND claim's one write.
 *
 * ⚠ THE ROLE IS THE LINK'S `granted_role`, NOT A HARDCODED `admin` (2026-08-25,
 * M2 — closes F-319). The bound link carries the role the claimer lands at
 * (default `guest`, ceiling `member`; the DB CHECK makes `admin`/`owner`-via-link
 * unrepresentable), so the claim is no longer a silent grant of workspace admin.
 * `owner` still stays with whoever MADE the container, so only they can delete
 * it. The "neither side is a guest in their own relationship" reasoning now
 * scopes to a MEMBER-grade link only — a guest link is precisely one where the
 * claimer is deliberately lower-privileged. The LEGACY unbound path
 * (`insertLinkContainer`) keeps its hardcoded `admin` on purpose (plan §4.3).
 *
 * ⚠ THERE IS NO MEMBER CAP TO CHECK — NOT HERE AND NOT IN THE DATABASE
 * (2026-08-26, Samuel's ruling; `20260830120000_link_container_multi_member.sql`
 * dropped the trigger). A third, fourth and fifth active member all insert
 * cleanly. **What bounds this write is possession of a bound, SINGLE-USE token**
 * — the caller above proved it and spent it — plus `assertMemberAddable`'s
 * standing `LINK_CONTAINER_CLOSED` refusal on every OTHER way into a container.
 */
export async function insertContainerMember(args: {
  workspaceId: string;
  userId: string;
  invitedBy: string;
  role: Role;
}): Promise<void> {
  const now = new Date().toISOString();
  const { error } = await supabaseAdmin().from("workspace_members").insert({
    workspace_id: args.workspaceId,
    user_id: args.userId,
    role: args.role,
    status: "active",
    invited_by: args.invitedBy,
    invited_at: now,
    joined_at: now,
  });
  if (error) throw error;
}

/** Undo an `insertContainerMember` — the rollback arm when the step after it
 *  fails. Hard delete rather than a status flip: a membership row for a claim
 *  that never completed is not history anybody reads, and leaving it revoked
 *  would put a person in the container's roster reads who was never admitted. */
export async function deleteContainerMember(
  workspaceId: string,
  userId: string
): Promise<void> {
  const { error } = await supabaseAdmin()
    .from("workspace_members")
    .delete()
    .eq("workspace_id", workspaceId)
    .eq("user_id", userId);
  if (error) throw error;
}

/**
 * `workspaceId` → EVERY other active member's user id, OLDEST JOIN FIRST. A
 * SOLO container has no entry, which is a legitimate state, not a broken row.
 *
 * ✅ **THIS IS F-307's FIX, AND IT IS BOTH HALVES OF IT (Samuel's ruling,
 * 2026-08-26).** It returned ONE id per container, taken as "whichever row
 * PostgREST handed back first" — correct only because the two-member cap made
 * "the other one" unambiguous. The cap came off the same day, so above two
 * members the same channel could render a different face between two loads,
 * with no error anywhere. **A LIST, and a TOTAL ORDER over it.**
 *
 * ⚠ **`user_id` IS THE TIEBREAKER AND IT IS NOT DECORATION.** `joined_at` alone
 * is not a total order — two members admitted in the same millisecond (or two
 * legacy rows carrying NULL) would still flip between loads, which is the exact
 * bug this read is being fixed for. `nullsFirst: false` puts an unstamped
 * legacy row LAST rather than at the head of the stack, where it would claim
 * the `peer` slot from a member who really did join first.
 *
 * ⚠ **ONE QUERY, AND THE ROW COUNT IS REAL DATA RATHER THAN A FAN (§9).** The
 * `.in()` spans at most `HOME_CHANNEL_LIMIT` containers and the rule §9 states
 * is "never a per-row query", which this still is not. What DID change is that
 * a container may now contribute more than one id, so the profile read above it
 * widens with the rosters — bounded by how many people are actually in the
 * caller's home channels, which is a relationship count and not a directory.
 */
export async function listContainerPeers(
  workspaceIds: string[],
  viewerId: string
): Promise<Map<string, string[]>> {
  const out = new Map<string, string[]>();
  if (workspaceIds.length === 0) return out;
  const { data, error } = await supabaseAdmin()
    .from("workspace_members")
    .select("workspace_id, user_id")
    .in("workspace_id", workspaceIds)
    .neq("user_id", viewerId)
    .eq("status", "active")
    .order("joined_at", { ascending: true, nullsFirst: false })
    .order("user_id", { ascending: true });
  if (error) throw error;
  for (const row of (data ?? []) as Array<{
    workspace_id: string;
    user_id: string;
  }>) {
    const seats = out.get(row.workspace_id);
    if (seats) seats.push(row.user_id);
    else out.set(row.workspace_id, [row.user_id]);
  }
  return out;
}

/** The container's channel, as the home payload names it. ⚠ The NAME rides
 *  along because a SOLO channel has no peer to be named after. */
export interface ContainerChannel {
  id: string;
  name: string;
}

/**
 * `workspaceId` → its ONE channel, oldest first.
 *
 * ⚠ NOT filtered on `is_direct` (2026-08-24). A container minted by "New
 * channel" holds a PRIVATE, NON-DIRECT channel — there is nobody to be direct
 * with yet — so the old `.eq("is_direct", true)` would have dropped every solo
 * channel off the page. A container holds exactly one channel either way, and
 * `created_at asc` makes "the first one" deterministic if that ever stops being
 * true.
 *
 * ⚠ NOT filtered on `deleted_at`: a DM soft-delete is the close half of
 * close/reopen (channels §5), so a hidden channel is still the container's
 * channel and the desktop revives it on the next open. Filtering here would drop
 * the whole relationship off the page.
 */
export async function listContainerChannels(
  workspaceIds: string[]
): Promise<Map<string, ContainerChannel>> {
  const out = new Map<string, ContainerChannel>();
  if (workspaceIds.length === 0) return out;
  const { data, error } = await supabaseAdmin()
    .from("channels")
    .select("id, workspace_id, name")
    .in("workspace_id", workspaceIds)
    .order("created_at", { ascending: true });
  if (error) throw error;
  for (const row of (data ?? []) as Array<{
    id: string;
    workspace_id: string;
    name: string;
  }>) {
    if (!out.has(row.workspace_id)) {
      out.set(row.workspace_id, { id: row.id, name: row.name });
    }
  }
  return out;
}

export interface LastMessage {
  at: string;
  body: string;
}

/**
 * `channelId` → its newest message. Two reads: the bounded
 * `channels_last_message` RPC picks the winning `seq` per channel (it is
 * workspace-agnostic and service-role only), then ONE bounded read over the
 * (channel, seq) CROSS PRODUCT, keyed back down here — a preview must not cost
 * a transcript scan. ⚠ The `.in(channel).in(seq)` pair over-fetches on purpose:
 * PostgREST has no row-tuple filter, so the query asks for every combination
 * and `byPair` discards the ones that were not asked for.
 */
export async function listLastMessages(
  channelIds: string[]
): Promise<Map<string, LastMessage>> {
  const out = new Map<string, LastMessage>();
  if (channelIds.length === 0) return out;
  const db = supabaseAdmin();
  const { data, error } = await db.rpc("channels_last_message", {
    p_channel_ids: channelIds,
  });
  if (error) throw error;
  const heads = (data ?? []) as Array<{
    channel_id: string;
    last_seq: number;
    last_at: string;
  }>;
  if (heads.length === 0) return out;

  const { data: bodies, error: bodyError } = await db
    .from("channel_messages")
    .select("channel_id, seq, body")
    .in("channel_id", heads.map((h) => h.channel_id))
    .in("seq", heads.map((h) => h.last_seq));
  if (bodyError) throw bodyError;

  const byPair = new Map<string, string>();
  for (const row of (bodies ?? []) as Array<{
    channel_id: string;
    seq: number;
    body: string;
  }>) {
    byPair.set(`${row.channel_id}:${row.seq}`, row.body);
  }
  for (const head of heads) {
    out.set(head.channel_id, {
      at: head.last_at,
      body: byPair.get(`${head.channel_id}:${head.last_seq}`) ?? "",
    });
  }
  return out;
}

/** ⚠ Supabase types a 1:1 embed as an array; flatten through `unknown`. */
function flattenWorkspaces(data: unknown): LinkContainerRow[] {
  const rows = (data ?? []) as Array<{
    workspace: LinkContainerRow | LinkContainerRow[] | null;
  }>;
  const out: LinkContainerRow[] = [];
  for (const row of rows) {
    const ws = Array.isArray(row.workspace) ? row.workspace[0] : row.workspace;
    if (ws) out.push(ws);
  }
  return out;
}

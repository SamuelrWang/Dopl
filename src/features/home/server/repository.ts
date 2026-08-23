import "server-only";
import { generatePublicId } from "@/shared/lib/id/public-id";
import { supabaseAdmin } from "@/shared/supabase/admin";
import {
  CHANNEL_LINK_COLS,
  LINK_CONTAINER_COLS,
  type ChannelLinkRow,
  type LinkContainerRow,
} from "./dto";

/**
 * Data access for home channels: the link table, and the `kind='link'`
 * container workspaces a claim mints. Every read selects COLUMNS and carries a
 * limit (§9); nothing here authorizes anything.
 */

/* ------------------------------- links -------------------------------- */

export async function insertLink(args: {
  creatorUserId: string;
  token: string;
  label: string | null;
  expiresAt: string | null;
  maxUses: number | null;
}): Promise<ChannelLinkRow> {
  const { data, error } = await supabaseAdmin()
    .from("channel_links")
    .insert({
      creator_user_id: args.creatorUserId,
      token: args.token,
      label: args.label,
      expires_at: args.expiresAt,
      max_uses: args.maxUses,
    })
    .select(CHANNEL_LINK_COLS)
    .single();
  if (error || !data) throw error || new Error("Failed to create link");
  return data as ChannelLinkRow;
}

/** The caller's un-revoked links, newest first. Expiry/exhaustion are judged in
 *  the service, by the same predicate the claim path uses. */
export async function listLinksByCreator(
  creatorUserId: string,
  limit: number
): Promise<ChannelLinkRow[]> {
  const { data, error } = await supabaseAdmin()
    .from("channel_links")
    .select(CHANNEL_LINK_COLS)
    .eq("creator_user_id", creatorUserId)
    .is("revoked_at", null)
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) throw error;
  return (data ?? []) as ChannelLinkRow[];
}

export async function findLinkByToken(
  token: string
): Promise<ChannelLinkRow | null> {
  const { data, error } = await supabaseAdmin()
    .from("channel_links")
    .select(CHANNEL_LINK_COLS)
    .eq("token", token)
    .maybeSingle();
  if (error) throw error;
  return (data as ChannelLinkRow | null) ?? null;
}

/** Creator-scoped by id — a link that is not the caller's reads as absent. */
export async function findLinkById(
  linkId: string,
  creatorUserId: string
): Promise<ChannelLinkRow | null> {
  const { data, error } = await supabaseAdmin()
    .from("channel_links")
    .select(CHANNEL_LINK_COLS)
    .eq("id", linkId)
    .eq("creator_user_id", creatorUserId)
    .maybeSingle();
  if (error) throw error;
  return (data as ChannelLinkRow | null) ?? null;
}

/** Revoke, scoped to the creator. `false` = no such link, or not theirs. */
export async function markLinkRevoked(
  linkId: string,
  creatorUserId: string
): Promise<boolean> {
  const { data, error } = await supabaseAdmin()
    .from("channel_links")
    .update({ revoked_at: new Date().toISOString() })
    .eq("id", linkId)
    .eq("creator_user_id", creatorUserId)
    .is("revoked_at", null)
    .select("id");
  if (error) throw error;
  return (data ?? []).length > 0;
}

/**
 * Spend one use, atomically. ⚠ `false` means the link was revoked, expired or
 * exhausted — do NOT re-read the row to find out which, and do not retry: the
 * guard and the increment are one statement precisely so nothing between them
 * can observe a half-state (`consume_channel_link`, migration 20260823150000).
 */
export async function consumeLinkUse(linkId: string): Promise<boolean> {
  const { data, error } = await supabaseAdmin().rpc("consume_channel_link", {
    p_link_id: linkId,
  });
  if (error) throw error;
  return (Array.isArray(data) ? data.length : data ? 1 : 0) > 0;
}

/** `false` = this account already claimed this link (the unique constraint). */
export async function insertClaim(args: {
  linkId: string;
  claimedBy: string;
  workspaceId: string;
}): Promise<boolean> {
  const { data, error } = await supabaseAdmin()
    .from("channel_link_claims")
    .upsert(
      {
        link_id: args.linkId,
        claimed_by: args.claimedBy,
        workspace_id: args.workspaceId,
      },
      { onConflict: "link_id,claimed_by", ignoreDuplicates: true }
    )
    .select("id");
  if (error) throw error;
  return (data ?? []).length > 0;
}

/* ----------------------------- containers ----------------------------- */

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
 * The pair's existing container, if any.
 *
 * ⚠ ONE query with BOTH memberships joined in, never a dedup over the listed
 * page: `listLinkContainers` is capped, so intersecting its results would miss
 * a pair whose container sits past the cap and mint a SECOND container for a
 * pair that already has one. Two aliased `!inner` embeds of the same table AND
 * together, so the filter is "A is a member and B is a member" evaluated in the
 * database over every row.
 *
 * A link container always has exactly two members, so that IS "members are
 * exactly {A, B}". `.limit(1)` keeps it bounded — a pair has at most one.
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
 * Mint the container. Creator owns it (and the workspace row's `owner_id`);
 * the claimer joins as `admin` so neither side is a guest in their own
 * relationship, and only the creator can delete it.
 *
 * ⚠ Rolls the workspace back if either member insert fails, exactly as
 * `workspaces/server/repository.ts › insertWorkspaceWithOwnerMembership` does —
 * an orphan container is unreachable and invisible, so nothing would ever find
 * it to clean it up.
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

/** `workspaceId` → the OTHER member's user id. */
export async function listContainerPeers(
  workspaceIds: string[],
  viewerId: string
): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  if (workspaceIds.length === 0) return out;
  const { data, error } = await supabaseAdmin()
    .from("workspace_members")
    .select("workspace_id, user_id")
    .in("workspace_id", workspaceIds)
    .neq("user_id", viewerId)
    .eq("status", "active");
  if (error) throw error;
  for (const row of (data ?? []) as Array<{
    workspace_id: string;
    user_id: string;
  }>) {
    if (!out.has(row.workspace_id)) out.set(row.workspace_id, row.user_id);
  }
  return out;
}

/**
 * `workspaceId` → its direct channel id. ⚠ NOT filtered on `deleted_at`: a DM
 * soft-delete is the close half of close/reopen (channels §5), so a hidden
 * channel is still the relationship's channel and the desktop revives it on the
 * next open. Filtering here would drop the whole relationship off the page.
 */
export async function listContainerDirectChannels(
  workspaceIds: string[]
): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  if (workspaceIds.length === 0) return out;
  const { data, error } = await supabaseAdmin()
    .from("channels")
    .select("id, workspace_id")
    .in("workspace_id", workspaceIds)
    .eq("is_direct", true);
  if (error) throw error;
  for (const row of (data ?? []) as Array<{ id: string; workspace_id: string }>) {
    if (!out.has(row.workspace_id)) out.set(row.workspace_id, row.id);
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

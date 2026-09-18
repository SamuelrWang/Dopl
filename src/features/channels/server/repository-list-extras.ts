import "server-only";
import { supabaseAdmin } from "@/shared/supabase/admin";
import type { Role, WorkspaceKind } from "@/features/workspaces/types";
import { CHANNEL_LINK_COLS, type ChannelLinkRow } from "@/shared/links/dto";
import { listMyChannelMemberships } from "./repository-account";
import type { ChannelMemberRow, ChannelRow } from "./dto-rows";

/**
 * DATA ACCESS FOR THE FIELDS A CHANNEL **ROW** CARRIES BEYOND ITS OWN HEADER —
 * the container it lives in, the caller's role there, the channel's roster, and
 * the open invitation bound to it (`types-list.ts › ChannelRowExtras`).
 *
 * ⚠ **ONE SET OF READS FOR BOTH SCOPES.** The scopes differ in the FENCE that
 * produces the channel ids; everything here takes those ids (or their containers)
 * and is identical either way.
 *
 * ⚠ **EVERY READ IS ONE BOUNDED `.in()`, NEVER A PER-ROW QUERY** (§9), keyed on
 * ids a fence already proved. Never build an id array from anything a caller sent.
 *
 * ⚠ **ITS OWN MODULE** for `repository-account.ts`'s reason: `repository.ts` is at
 * §1's cap, and a set of queries with a DIFFERENT fence inside the hot per-channel
 * file is how one of them quietly inherits the wrong `WHERE`.
 */

/** The container half of a row's address (`workspaces`, named columns per §9). */
export interface ContainerRow {
  id: string;
  slug: string;
  public_id: string;
  kind: WorkspaceKind | null;
}

/**
 * `workspaceId` → its row. ⚠ **`kind` MAY BE NULL** — a narrowed projection or a
 * pre-`20260823150000` row carries none, and the DTO reads absent as `standard`
 * through the POSITIVE predicate (§4A). It is not defaulted here: a repository
 * that invents a value hides which rows actually carry one.
 */
export async function listContainers(
  workspaceIds: string[]
): Promise<Map<string, ContainerRow>> {
  const out = new Map<string, ContainerRow>();
  if (workspaceIds.length === 0) return out;
  const { data, error } = await supabaseAdmin()
    .from("workspaces")
    .select("id, slug, public_id, kind")
    .in("id", workspaceIds);
  if (error) throw error;
  for (const row of (data ?? []) as ContainerRow[]) out.set(row.id, row);
  return out;
}

/**
 * `workspaceId` → THE CALLER'S OWN ROLE there (`workspace_members.role`).
 *
 * ⚠ **THE MEMBERSHIP ROW IS THE ONLY SOURCE, WHICH IS THE POINT OF F-343.** /home
 * hardcoded `"owner"` — true of a container the caller CREATED, false of every one
 * they JOINED, where a bound claim seats them at the link's `granted_role`.
 * ⚠ **AN ABSENT ENTRY IS A REAL ANSWER**, read as `EMPTY_WORKSPACE_ROLE`.
 */
export async function listMyContainerRoles(
  workspaceIds: string[],
  viewerId: string
): Promise<Map<string, Role>> {
  const out = new Map<string, Role>();
  if (workspaceIds.length === 0) return out;
  const { data, error } = await supabaseAdmin()
    .from("workspace_members")
    .select("workspace_id, role")
    .in("workspace_id", workspaceIds)
    .eq("user_id", viewerId)
    .eq("status", "active");
  if (error) throw error;
  for (const row of (data ?? []) as Array<{ workspace_id: string; role: Role }>) {
    out.set(row.workspace_id, row.role);
  }
  return out;
}

/**
 * `channelId` → the OTHER members' ids, OLDEST JOIN FIRST, capped per channel by
 * the caller.
 *
 * 🔒 ⚠ **THE ORDER IS TOTAL — `joined_at ASC, user_id ASC` — AND THE TIEBREAKER IS
 * LOAD-BEARING (F-307).** `joined_at` alone is not a total order: two members
 * admitted in the same millisecond, or a legacy row carrying NULL, flip between
 * loads and the faces shuffle. `nullsFirst: false` puts an unstamped legacy row
 * LAST rather than at the head, where it would claim the first face from somebody
 * who really did join first.
 *
 * ⚠ **THE CAP IS APPLIED PER CHANNEL IN CODE**, because PostgREST cannot express
 * one limit per group; the query's own `limit` is the page ceiling over the whole
 * `.in()` and is the caller's to size.
 */
export async function listChannelPeerIds(
  channelIds: string[],
  viewerId: string,
  perChannel: number,
  rowLimit: number
): Promise<Map<string, string[]>> {
  const out = new Map<string, string[]>();
  if (channelIds.length === 0) return out;
  const { data, error } = await supabaseAdmin()
    .from("channel_members")
    .select("channel_id, user_id")
    .in("channel_id", channelIds)
    .neq("user_id", viewerId)
    .order("joined_at", { ascending: true, nullsFirst: false })
    .order("user_id", { ascending: true })
    .limit(rowLimit);
  if (error) throw error;
  for (const row of (data ?? []) as Array<{
    channel_id: string;
    user_id: string;
  }>) {
    const seats = out.get(row.channel_id);
    if (seats === undefined) out.set(row.channel_id, [row.user_id]);
    else if (seats.length < perChannel) seats.push(row.user_id);
  }
  return out;
}

/**
 * `workspaceId` → its open BOUND link — the row's "invitation out" chip.
 *
 * ⚠ **MOVED HERE FROM `home/server/repository.ts` IN WAVE 3 (R-26)**: the chip is a
 * field of `Channel` and §1 forbids `channels → home`. The column list and the
 * claimability predicate moved DOWN to `shared/links/` TOGETHER, so the gate and
 * the chip still cannot disagree.
 *
 * Backed by `channel_links_workspace_idx` (`20260824120000`) — at most one row per
 * workspace by unique index, so `limit` is a safety ceiling rather than a page.
 *
 * ⚠ **REVOKED ROWS ARE FILTERED IN SQL; EXPIRED AND EXHAUSTED ONES ARE NOT** —
 * those are time-dependent, and the claim gate's own predicate judges them at map
 * time.
 */
export async function listLinksByWorkspaces(
  workspaceIds: string[],
  limit: number
): Promise<Map<string, ChannelLinkRow>> {
  const out = new Map<string, ChannelLinkRow>();
  if (workspaceIds.length === 0) return out;
  const { data, error } = await supabaseAdmin()
    .from("channel_links")
    .select(CHANNEL_LINK_COLS)
    .in("workspace_id", workspaceIds)
    .is("revoked_at", null)
    .limit(limit);
  if (error) throw error;
  for (const row of (data ?? []) as ChannelLinkRow[]) {
    if (row.workspace_id && !out.has(row.workspace_id)) {
      out.set(row.workspace_id, row);
    }
  }
  return out;
}

/**
 * 🔒 **THE `scope=account` FENCE — the full channel rows behind the ONE PROOF,
 * `repository-account.ts › listMyChannelMemberships`.** That helper is the only
 * source of a `channelIds` array here, and it carries the container lock (R3),
 * the stable order and the reported ceiling, stated once for both account reads.
 *
 * ⚠ **MEMBERSHIP, DELIBERATELY NOT VISIBILITY.** A PUBLIC channel the caller never
 * joined is admitted by `repository.ts › listChannels` and is NOT here: an account
 * surface must not fill with rooms nobody invited you into. Fewer rows can never
 * be a leak.
 *
 * ⚠ **`deleted_at IS NULL` IS NOT OPTIONAL** — a soft-deleted channel is NOT-FOUND
 * to every other read, and a membership row outlives the tombstone.
 *
 * ⚠ The PROOF is the read that can clip; this one is bounded by the id set it was
 * handed, so its `truncated` is the proof's.
 */
export async function listAccountChannelRows(
  userId: string,
  lockedWorkspaceId: string | null,
  limit: number
): Promise<{ rows: ChannelRow[]; truncated: boolean }> {
  const { rows: memberships, truncated } = await listMyChannelMemberships(
    userId,
    lockedWorkspaceId,
    limit
  );
  if (memberships.length === 0) return { rows: [], truncated };
  const { data, error } = await supabaseAdmin()
    .from("channels")
    // ⚠ `select("*")` MATCHES `repository.ts › listChannels`, which §9 records as
    // a known non-conformer. One projection means one column set: narrowing here
    // alone would give the account scope a thinner row than the container scope
    // off the same mapper, which is the fork this file exists to close.
    .select("*")
    .in(
      "id",
      memberships.map((row) => row.channel_id)
    )
    .is("deleted_at", null)
    .order("updated_at", { ascending: false })
    .limit(limit);
  if (error) throw error;
  return { rows: (data ?? []) as ChannelRow[], truncated };
}

/** The caller's own `channel_members` rows for these channels — the watermark,
 *  the pin, the channel role, and the fact the row EXISTS at all. ⚠ An ABSENT row
 *  is an ANSWER: no marks, no pin, not a member. */
export async function listMyMembershipsByChannel(
  channelIds: string[],
  userId: string
): Promise<Map<string, ChannelMemberRow>> {
  const out = new Map<string, ChannelMemberRow>();
  if (channelIds.length === 0) return out;
  const { data, error } = await supabaseAdmin()
    .from("channel_members")
    .select("*")
    .in("channel_id", channelIds)
    .eq("user_id", userId);
  if (error) throw error;
  for (const row of (data ?? []) as ChannelMemberRow[]) {
    out.set(row.channel_id, row);
  }
  return out;
}

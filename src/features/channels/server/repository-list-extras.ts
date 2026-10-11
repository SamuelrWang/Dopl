import "server-only";
import { supabaseAdmin } from "@/shared/supabase/admin";
import { POSTGREST_MAX_ROWS, readAllPages } from "@/shared/supabase/max-rows";
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
 * one limit per group; the query's own ceiling is the page bound over the whole
 * `.in()` and is the caller's to size.
 *
 * ── 🔒 PAGED, AND THE TIEBREAKER GREW A THIRD COLUMN ───────────────────────
 *
 * 🔒 **`.limit(rowLimit)` WAS NOT THE BOUND IN FORCE (Samuel #2935).** The caller
 * passes `service-list.ts › PEER_ROW_LIMIT` = 2,000 and `supabase/config.toml ›
 * max_rows` ({@link POSTGREST_MAX_ROWS}) clipped it to 1,000 server-side with no
 * error — so a page of busy channels lost its LAST channels' faces at half the
 * declared ceiling. The symptom was indistinguishable from an empty roster, which
 * is why it survived: the surface draws no faces either way.
 *
 * 🔒 ⚠ **`channel_id` JOINED THE ORDER AND IT IS NOT DECORATION.** F-307 made the
 * order total *within one channel* — `joined_at` plus `user_id` — and this read
 * spans channels, where that pair is **NOT UNIQUE**: `now()` is TRANSACTION-wide
 * in Postgres, so one statement seating a member in two channels stamps both rows
 * the same `joined_at`, and `user_id` is then equal too. Two indistinguishable
 * rows across a page boundary is the paging failure that returns one twice and
 * drops the other — and the dropped one is a missing face in the OTHER channel.
 * `PRIMARY KEY (channel_id, user_id)` closes it.
 * ⚠ **IT IS LAST, SO OLDEST-JOIN-FIRST STILL DECIDES WHICH FACES SURVIVE**
 * `perChannel`. A `channel_id`-first order would reshuffle the seats F-307 fixed.
 */
export async function listChannelPeerIds(
  channelIds: string[],
  viewerId: string,
  perChannel: number,
  rowLimit: number
): Promise<Map<string, string[]>> {
  const out = new Map<string, string[]>();
  if (channelIds.length === 0) return out;
  const db = supabaseAdmin();
  const { rows } = await readAllPages<{ channel_id: string; user_id: string }>(
    // ⚠ A FRESH QUERY PER PAGE. A Supabase builder is a one-shot thenable;
    // re-awaiting one re-sends the first range and the walk spins on page 0.
    async (from, toInclusive) => {
      const { data, error } = await db
        .from("channel_members")
        .select("channel_id, user_id")
        .in("channel_id", channelIds)
        .neq("user_id", viewerId)
        .order("joined_at", { ascending: true, nullsFirst: false })
        .order("user_id", { ascending: true })
        .order("channel_id", { ascending: true })
        .range(from, toInclusive);
      return {
        data: (data ?? []) as unknown as Array<{
          channel_id: string;
          user_id: string;
        }>,
        error,
      };
    },
    // ⚠ `rowLimit` IS STILL THE CEILING AND STILL THE CALLER'S TO SIZE — the
    // difference is that the rows beneath it now actually arrive. The page size is
    // the SERVER's ceiling, which is what makes a short page proof of exhaustion.
    { hardCap: rowLimit, pageSize: POSTGREST_MAX_ROWS }
  );
  for (const row of rows) {
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

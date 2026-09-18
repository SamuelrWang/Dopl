/**
 * THE ONE CHANNEL-LIST PROJECTION — the fields a channel ROW carries beyond its
 * own header, and the payload both scopes of `GET /api/channels` answer with
 * (Samuel's ruling R-26 (b), 2026-09-17: *one endpoint*).
 *
 * 🔒 **THERE WAS A SECOND PROJECTION AND IT IS DELETED.** `GET /api/home/channels`
 * answered `home/types.ts › HomeChannel` — a 15-field type over the same question
 * `Channel` answers with 26 — into a second client cache, with `myFavoritedAt`
 * spelled `favoritedAt` (R-27) and two hand-written cache-to-cache BRIDGES keeping
 * the two entries from disagreeing. The bridges are gone because the second cache
 * is: one projection needs no bridge.
 *
 * ⚠ **THESE FIELDS ARE ON EVERY ROW OF BOTH SCOPES, NEVER ONLY THE ACCOUNT ONE.**
 * What DIFFERS per scope is the FENCE, never the shape.
 *
 * ⚠ **IN ITS OWN FILE ONLY BECAUSE `types.ts` IS AT §1's 500-LINE CAP.** It is one
 * type with `Channel`, re-exported from there, so `@/features/channels/types` stays
 * the one import path.
 */

import type { Role, WorkspaceKind } from "@/features/workspaces/types";

/** How wide / how deep this file's two bounded lists are allowed to go. */
export const CHANNEL_PEER_LIMIT = 20;

/**
 * 🔒 **THE CHANNEL'S CONTAINER, TYPED — R-32's addressing contract on the row**
 * (Samuel, 2026-09-17: home must be *structurally distinct, never just a prompt
 * line*).
 *
 * ⚠ **`kind` IS ASKED POSITIVELY** (`kind === "link"`, or a `switch` with a
 * `default`), never `!isStandardWorkspace(…)` — §4A / master §4.2 G3. A fourth kind
 * is then excluded by construction rather than silently admitted.
 */
export interface ChannelContainer {
  /** `workspaces.id` — the `workspace=` handle every other tool takes. */
  id: string;
  kind: WorkspaceKind;
  /** `{slug}-{publicId}` — what the channels client APIs address by. */
  segment: string;
}

/**
 * Another member of a channel, resolved from their profile.
 *
 * ⚠ Resolved LIVE, never stored as truth — a display name or avatar changes.
 * ⚠ A member with NO profile row is KEPT, not dropped: a face the operator
 * cannot name is still a person in the room, and dropping them would silently
 * shrink the roster the row claims to show.
 */
export interface ChannelPeer {
  userId: string;
  displayName: string | null;
  email: string | null;
  avatarUrl: string | null;
}

// 🔒 **THE OPEN BOUND LINK'S SHAPE IS `shared/links/types.ts`'s**, re-exported
// here under the name `Channel` uses. It is the HOME feature's table and a
// CHANNEL's state at once, and §1 forbids `channels → home` — so it moved DOWN
// rather than being written twice. ⚠ A pending peer is a STATE of a channel, not
// a second row beside it; the LEGACY unbound links (no container, so no channel
// to hang off) are the payload's own `pendingLinks`, and a link is never in both.
export type { ChannelPendingLink } from "@/shared/links/types";
import type { ChannelPendingLink } from "@/shared/links/types";
// ⚠ TYPE-ONLY, so the `types.ts ↔ types-list.ts` edge is erased at build: that
// file `export *`s this one, and `Channel` is the row THIS file's list payload
// carries.
import type { Channel } from "./types";

/**
 * 🔒 The absent-fallback for {@link ChannelRowExtras.peers} — INVARIANTS §8's
 * `EMPTY_X`. **Spell `?? EMPTY_PEERS` INLINE at every read**: the wire type is
 * non-optional, so the read site is the only place the optionality is visible.
 * ⚠ FROZEN and shared — it is handed straight to render paths.
 */
export const EMPTY_PEERS: readonly ChannelPeer[] = Object.freeze([]);

/**
 * 🔒 The absent-fallback for {@link ChannelListPayload.channels} — the same §8
 * `EMPTY_X`, and for the same reason plus one: `use-channels.ts`'s `?? []` sat
 * inside a TanStack `select`, so it minted a NEW array identity on every render
 * and churned every memo keyed on the result.
 * ⚠ FROZEN and shared — it is handed straight to render paths.
 */
export const EMPTY_CHANNELS: readonly Channel[] = Object.freeze([]);

/**
 * 🔒 The absent-fallback for {@link ChannelRowExtras.myWorkspaceRole} — `guest`,
 * rank 0, which is Samuel's direction on F-343: **fail closed.** A stale entry
 * renders DISPLAY-ONLY and one repaint restores the affordance, where the other
 * direction is a surface asserting a permission it has not read.
 */
export const EMPTY_WORKSPACE_ROLE: Role = "guest";

/**
 * What a channel ROW carries beyond its own header — folded onto `Channel`, so
 * there is one type and one cache entry per scope.
 */
export interface ChannelRowExtras {
  container: ChannelContainer;
  /**
   * 🔒 **THE CALLER'S OWN ROLE IN THE CONTAINER — `workspace_members.role`, never
   * a client param** (F-343). ⚠ **NOT `Channel.role`, WHICH IS THE CHANNEL ROLE**
   * (`ChannelRole`, no `guest`): two different ladders over two different
   * memberships, so they get two names. The vocabulary here is the WORKSPACE's,
   * read through `meetsMinRole` — the same spelling `ChannelMember.workspaceRole`
   * already uses for the same fact one row over.
   *
   * ⚠ `null` for a container whose membership row did not come back — a torn
   * read, not a state. Every READ spells `?? EMPTY_WORKSPACE_ROLE` inline.
   *
   * 🔒 **A PICTURE OF THE SERVER'S ANSWER, NOT A FENCE.** Every write is floored
   * server-side already; what this buys is that a surface stops OFFERING what the
   * server will refuse (§5's dead-control rule).
   */
  myWorkspaceRole: Role | null;
  /**
   * EVERY other member of the channel, OLDEST JOIN FIRST, capped at
   * {@link CHANNEL_PEER_LIMIT}. Empty for a channel the caller is alone in.
   *
   * ⚠ **THE ORDER IS TOTAL — `joined_at ASC, user_id ASC`** — or the faces shuffle
   * between loads, which was F-307. The `user_id` tiebreaker is load-bearing:
   * `joined_at` alone is not a total order and legacy rows carry NULL.
   *
   * ⚠ **A SAMPLE, AND `memberCount` IS THE TOTAL.** A `+N` overflow counts against
   * `memberCount`, never against `peers.length` — at the cap they disagree, and
   * the count is the one that is true.
   *
   * ⚠ **IT IS THE CHANNEL'S ROSTER, NOT THE CONTAINER'S** — a change from the
   * deleted `HomeChannel.peers`, which read `workspace_members`. On a `kind='link'`
   * container the two coincide by construction (one channel, and the bound claim
   * inserts both rows in one service), and the channel roster is the honest basis
   * for a row that IS a channel.
   */
  peers: ChannelPeer[];
  /**
   * 🔒 **HOW MANY MESSAGES NEWER THAN THE CALLER'S WATERMARK TAG THE CALLER** — the
   * row's `@ N` pill, hidden at 0 (R-28, 2026-09-17).
   *
   * ⚠ **THE BOUNDARY IS `channel_members.last_read_at`, NOT `channel_mention_reads`.**
   * The Tags inbox marks mentions read one at a time because that list is picked
   * over out of order; a row badge is ONE mark whose clearing act is OPENING THE
   * CHANNEL, so it shares the dot's watermark. **The consequence, stated rather than
   * discovered:** clicking one mention read in the inbox does not decrement this,
   * and scrolling the transcript does clear it.
   *
   * ⚠ **0 FOR A NON-MEMBER** — no watermark to advance, so a badge could never clear.
   * ⚠ Every read spells `?? 0` inline (§8): `0` hides the pill, never `@ NaN`.
   */
  mentionCount: number;
  /** The open BOUND invitation on this channel, or null. Judged by the SAME
   *  predicate the claim gate uses (`home/server/dto.ts › isClaimable`) — a chip
   *  saying "invite out" over a link that 410s is what that predicate prevents. */
  linkOut: ChannelPendingLink | null;
}

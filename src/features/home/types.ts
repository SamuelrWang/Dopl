/**
 * Home surface contracts — what is LEFT of them.
 *
 * 🔒 **THE CHANNEL ROW IS GONE FROM THIS FILE (Wave 3, Samuel's ruling R-26 (b)).**
 * `HomeChannel`, `HomeChannelsPayload`, `HomePeer`, `HomePendingLink`,
 * `EMPTY_PEERS` and `EMPTY_ROLE` all stated a SECOND answer to *"which channels am
 * I in and what is their state"* — 15 fields against `Channel`'s 26, off a second
 * route, into a second client cache, with `favoritedAt` spelled differently (R-27)
 * and two hand-written cache-to-cache BRIDGES holding the two entries together.
 * **One projection**: `channels/types.ts › Channel`, read with
 * `GET /api/channels?scope=account`. The peer and the pending link moved with it —
 * `› ChannelPeer`, and `shared/links/types.ts › ChannelPendingLink`.
 *
 * ⚠ **DO NOT RE-DERIVE A HOME-SHAPED CHANNEL TYPE HERE**, however small. The three
 * things this file still owns are the CLAIM lane's own payloads, which are about a
 * LINK rather than about a channel row.
 */

import type { Channel } from "@/features/channels/types";
import type { ChannelPendingLink } from "@/shared/links/types";

/**
 * Public metadata a claim page may show before auth — never the token owner's
 * identity beyond a display name.
 *
 * ⚠ IT DOES NOT CARRY THE CHANNEL'S NAME, and must not grow one: the holder of
 * a URL is unauthenticated by definition, and the name of a private channel is
 * not a fact a URL should hand out.
 */
export interface HomeLinkPublicInfo {
  creatorDisplayName: string | null;
  expired: boolean;
  revoked: boolean;
  exhausted: boolean;
}


/**
 * Payload of `POST /api/channels?scope=account` — "New channel": a solo container
 * plus one private channel inside it.
 *
 * ⚠ **THE ROW IS `Channel`, THE ONE PROJECTION**, so a freshly-minted channel and
 * one read off the list are byte-identical in shape and the create can PATCH the
 * list cache instead of invalidating it.
 */
export interface HomeChannelCreateResult {
  channel: Channel;
}

/** Payload of `POST /api/home/links` and rows of `GET /api/home/links`. */
export interface HomeLinkMintResult {
  link: ChannelPendingLink;
}

/** Payload of `POST /api/home/link/[token]/claim`. */
export interface HomeLinkClaimResult {
  channel: Channel;
  /** True when the pair already had a container and it was reused. */
  existing: boolean;
  /**
   * TRUE when the link named its container and the claim JOINED it; FALSE when the
   * link was a legacy unbound one and the claim MINTED the container. The two
   * outcomes look identical in the payload and are entirely different writes, so
   * the answer says which happened.
   */
  bound: boolean;
}

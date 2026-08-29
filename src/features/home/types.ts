/**
 * Home surface contracts — account-level (cross-org) channels.
 *
 * ⚠ INVERTED 2026-08-24 (Samuel's ruling). A home channel is no longer BORN of
 * a claim: "New channel" mints a hidden `kind='link'` container with ONE member
 * and one private, non-direct channel inside it, and the operator talks to their
 * own agents there. Adding a person is a SEPARATE, LATER act — a link BOUND to
 * that container, whose claim inserts the peer as its second member. So a
 * channel has a PEER or it does not, and both are finished states.
 *
 * `GET /api/home/channels` returns the channels plus the caller's still-open
 * LEGACY unbound links; a BOUND link rides on its own channel as `linkOut`.
 */

import type { Role } from "@/features/workspaces/types";

/** Another person in a channel, resolved from their profile. */
export interface HomePeer {
  userId: string;
  displayName: string | null;
  email: string | null;
  avatarUrl: string | null;
}

/**
 * The absent-fallback for {@link HomeChannel.peers} — INVARIANTS §8's `EMPTY_X`,
 * matching what a container with nobody else in it serialises to.
 *
 * 🔒 **SPELL IT `?? EMPTY_PEERS` INLINE AT EVERY READ, never behind an
 * accessor.** The wire type is non-optional, so the read site is the only place
 * the optionality is visible, and a rule living inside a helper nobody has to
 * call is a rule the next read forgets (the deleted `infoCardOf()` is the
 * precedent). ⚠ `channel?.peers` guards the CHANNEL being absent and does
 * NOTHING about a live stale channel whose KEY is `undefined` — that is the
 * 2026-08-26 correction in §8, and it is why this is per-key.
 *
 * ⚠ FROZEN, and shared: it is handed straight to render paths, so a caller that
 * pushed into it would be editing every other caller's fallback.
 */
export const EMPTY_PEERS: readonly HomePeer[] = Object.freeze([]);

/** One home channel — addresses its container like any workspace. */
export interface HomeChannel {
  /** The `kind='link'` container workspace. */
  workspaceId: string;
  /** `{slug}-{publicId}` — what the channels client APIs address by. */
  workspaceSegment: string;
  /** The single channel inside the container. */
  channelId: string;
  /** The CHANNEL's own name — what a solo channel is called, since there is no
   *  peer to name it after. */
  name: string;
  /**
   * EVERY other member of the container, OLDEST JOIN FIRST — F-307's fix
   * (Samuel's ruling, 2026-08-26: a home channel takes more than two people).
   * Empty for a solo channel. The order is TOTAL and comes from the repository
   * (`joined_at ASC, user_id ASC`), so the faces do not shuffle between loads.
   *
   * 🔒 ⚠ **NEW KEY ON AN INDEXEDDB-PERSISTED PAYLOAD — EVERY READ SPELLS
   * `?? EMPTY_PEERS` INLINE (INVARIANTS §8).** `GET /api/home/channels` is
   * cached with a 24h `gcTime`, so an entry written by the previous bundle
   * survives the upgrade WITHOUT this key: the wire type is non-optional and is
   * right, the cache is a different moment. **`.length` and `.map` on
   * `undefined` THROW and blank the pane** — this is the object-field case §8
   * names, not the decorative one.
   */
  peers: HomePeer[];
  /**
   * The FIRST other member, or null. ⚠ **DERIVED FROM `peers[0]` IN EXACTLY ONE
   * PLACE** (`server/service-reads.ts › hydrateChannels`) and never computed
   * independently — two fields that can disagree about who is in a room is the
   * whole reason F-307 was filed.
   *
   * ⚠ **KEPT RATHER THAN REPLACED BY `peers`, AND THE REASON IS THE CACHE.** An
   * entry cached before 2026-08-26 HAS this key and LACKS `peers`, so a reader
   * that only knew `peers` would fall back to `[]` and paint every one of the
   * operator's channels as SOLO — "Just you", the agent glyph, the wrong
   * roster — on the first paint after the upgrade. That is a FALSE sentence,
   * where degrading to this field is merely the old, correct, one-face answer.
   *
   * ⚠ NULL IS NOT A DEFECT. A solo channel has no second member until somebody
   * claims its link; a card with no face is the correct rendering of "just
   * you", not a half-built one. **Its meaning is now STATED** — "the member who
   * joined first" — where before the cap came off it was "whichever row came
   * back first", which is what made it non-deterministic (F-307).
   */
  peer: HomePeer | null;
  createdAt: string;
  lastMessageAt: string | null;
  /** Pre-truncated server-side; null when the channel is empty. */
  lastMessagePreview: string | null;
  /**
   * The open BOUND link, when this channel has an invitation out. Rendered as a
   * chip ON this channel's row — a pending peer is a STATE of the channel, not
   * a second row beside it.
   */
  linkOut: HomePendingLink | null;
}

/** A minted, not-yet-claimed link. Only ever the caller's own. */
export interface HomePendingLink {
  id: string;
  /** Full claim URL, e.g. `https://www.usedopl.com/link/<token>` (`src/features/home/server/dto.ts › claimUrl`). */
  url: string;
  label: string | null;
  createdAt: string;
  expiresAt: string | null;
  /** null = multi-use. */
  maxUses: number | null;
  useCount: number;
  revokedAt: string | null;
  /**
   * ⚠ WHAT THIS LINK GRANTS ITS CLAIMER, AND IT IS ON THE PAYLOAD BECAUSE
   * WITHOUT IT NOTHING DOWNSTREAM COULD TELL (added 2026-08-26). M3 gave the
   * operator a role picker; `mintContainerLink` RETURNS an open link rather
   * than replacing it, and until this field existed the returned link's
   * `granted_role` was invisible — so picking "Member — full channel" over an
   * open GUEST link answered 200 with the guest link, and the peer landed as a
   * guest. (It now revokes and re-mints on a mismatch; this field is what lets
   * the UI SAY what an existing invitation grants.)
   *
   * ⚠ STALE-CACHE (§8): a `linkOut` cached before this field existed reads
   * `undefined`. Every consumer must fall back — the fail-safe reading is the
   * DB default, `"guest"`.
   */
  grantedRole: Role;
}

/**
 * Payload of `GET /api/home/channels`.
 *
 * ⚠ `pendingLinks` IS THE LEGACY TAIL ONLY — unbound links, which have no
 * channel to hang off and so must be rows of their own. A BOUND link is never
 * here; it is its channel's `linkOut`. Two lists would show one invitation
 * twice.
 */
export interface HomeChannelsPayload {
  channels: HomeChannel[];
  pendingLinks: HomePendingLink[];
}

/** Payload of `POST /api/home/channels`. */
export interface HomeChannelCreateResult {
  channel: HomeChannel;
}

/** Payload of `POST /api/home/links` and rows of `GET /api/home/links`. */
export interface HomeLinkMintResult {
  link: HomePendingLink;
}

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

/** Payload of `POST /api/home/links/[token]/claim`. */
export interface HomeLinkClaimResult {
  channel: HomeChannel;
  /** True when the pair already had a container and it was reused. */
  existing: boolean;
  /**
   * TRUE when the link named its container and the claim JOINED it; FALSE when
   * the link was a legacy unbound one and the claim MINTED the container. The
   * two outcomes look identical in the payload and are entirely different
   * writes, so the answer says which happened.
   */
  bound: boolean;
}

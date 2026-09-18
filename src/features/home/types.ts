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

/**
 * The absent-fallback for {@link HomeChannel.role} — INVARIANTS §8's `EMPTY_X`
 * for the CALLER'S OWN ROLE in a container.
 *
 * 🔒 **IT IS `guest`, WHICH IS RANK 0, AND THAT DIRECTION IS THE RULING
 * (Samuel, 2026-09-17, closing F-343).** The finding filed the trade rather than
 * picking it: an entry cached by the previous bundle carries NO `role` key, so
 * defaulting to `member` keeps today's buttons on screen for everybody and
 * defaulting to `guest` takes them off every member's first paint after the
 * upgrade. **A stale cache renders DISPLAY-ONLY**: one repaint restores the
 * affordance, where the other direction is this surface asserting a permission
 * it has not read — which is the exact defect F-343 is about.
 *
 * 🔒 **SPELL IT `?? EMPTY_ROLE` INLINE AT EVERY READ, never behind an
 * accessor** — the wire type is non-optional, so the read site is the only place
 * the optionality is visible (§8; the deleted `infoCardOf()` is the precedent).
 * ⚠ `channel?.role` guards the CHANNEL being absent and does NOTHING about a
 * live stale channel whose KEY is `undefined`.
 */
export const EMPTY_ROLE: Role = "guest";

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
   * **THE CHANNEL'S DESCRIPTION — `channels.topic`** (Samuel, 2026-09-15).
   *
   * ⚠ **THE WIRE WORD IS `topic` AND THE READER'S WORD IS "Description"**, which
   * is not drift: `channels/components/info-tab.tsx` carries the ruling that the
   * product says "Description" over the column the New-channel popup and the MCP
   * both write as `topic`. Spelling it `topic` here keeps this payload saying what
   * the `Channel` DTO already says (`channels/types.ts`), so one fact has one name
   * on the wire.
   *
   * ⚠ **`""` IS "NO DESCRIPTION", NOT `null`.** The column is `NOT NULL DEFAULT ''`
   * and this mirrors it, so every reader tests emptiness — a second spelling of
   * absence (`null`) would mean two checks for one state.
   *
   * 🔒 **ITS ONE RENDERER IS THE PICKER ROW'S SECOND LINE, AND ONLY WHEN THE
   * CHANNEL IS SOLO** (`pages/home/relationship-list.tsx`): a channel with other
   * people in it shows their FACES there instead. That is Samuel's rule, and it is
   * the renderer's to state — this field is simply the fact.
   *
   * 🔒 ⚠ **NEW KEY ON AN INDEXEDDB-PERSISTED PAYLOAD — EVERY READ SPELLS `?? ""`
   * INLINE (INVARIANTS §8).** `GET /api/home/channels` is cached with a 24h
   * `gcTime`, so an entry written by the previous bundle survives the upgrade
   * WITHOUT this key. `""` is the fail-safe reading: the row keeps today's look
   * rather than printing `undefined` under a channel name.
   */
  topic: string;
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
  /**
   * Pre-truncated server-side; null when the channel is empty.
   *
   * 🔒 **NOTHING RENDERS IT SINCE 2026-09-13 (Samuel, over a screenshot of the
   * list: having "the most recent message being in there just doesn't make sense
   * imo").** The row's second line is the roster + the unread marks below. It
   * stays ON THE WIRE because the SDK mirrors this type
   * (`packages/dopl-client/src/home-types.ts`, committed `dist/`), so removing it
   * is a cross-package change with a build gate and no gain. **Do not add a
   * second renderer** — the ruling is about the ROW, and there is no other
   * surface for a home-channel preview to appear on.
   */
  lastMessagePreview: string | null;
  /**
   * Is there a message here newer than the caller's own read watermark — the
   * row's plain-dot marker (2026-09-13).
   *
   * ⚠ CALLER-RELATIVE, like `Channel.unread` / `Channel.lastReadAt`, and it
   * carries no `my*` prefix for the reason the rest of this payload does not: a
   * home payload is only ever the caller's own. The rule is ONE function shared
   * with the dot's own arithmetic — `server/unread-tally.ts › isChannelUnread`,
   * which is `mapChannelRow`'s rule with the `isMember` clause moved to the
   * caller. **FALSE for a channel the caller is not a channel member of**: there
   * is no watermark there that opening the channel could advance.
   *
   * 🔒 ⚠ **NEW KEY ON AN INDEXEDDB-PERSISTED PAYLOAD — EVERY READ SPELLS
   * `?? false` INLINE (INVARIANTS §8).** `GET /api/home/channels` is cached with
   * a 24h `gcTime`, so an entry written by the previous bundle survives the
   * upgrade WITHOUT this key. `false` is the fail-safe reading: a marker that is
   * briefly absent is a missed nudge, where `true` would print a dot on every
   * row of a list nobody has any news in.
   */
  unread: boolean;
  /**
   * How many messages newer than the caller's watermark TAG the caller — the
   * row's `@ N` pill, hidden at 0 (Samuel, 2026-09-13: the row wants "some
   * notification system for new @s").
   *
   * ⚠ **THE WATERMARK IS THE BOUNDARY, NOT `channel_mention_reads`** — the Tags
   * inbox's per-message read-state answers a different question and the
   * divergence is deliberate. `server/repository-unread.ts` carries the ruling
   * and its one consequence (marking a single mention read in the inbox does not
   * decrement this).
   *
   * 🔒 ⚠ **NEW KEY ON AN INDEXEDDB-PERSISTED PAYLOAD — EVERY READ SPELLS `?? 0`
   * INLINE (INVARIANTS §8)**, for the reason `unread` above states. `0` is the
   * fail-safe: the pill is hidden rather than printing `@ NaN`.
   */
  unreadMentions: number;
  /**
   * 🔒 **WHEN THE CALLER PINNED THIS CHANNEL, OR null — AND THE PIN IS THE
   * BOOKMARK (Samuel, 2026-09-15):** *"remove the pin icon that appears when i
   * hover over the picker. instead replace the bookmark icon next to the channel
   * name with the pin icon."* ⚠ **ONE FACT, SERVER-BACKED, WRITTEN FROM ONE
   * PLACE**: `channel_members.favorited_at`, set by the channel header's toggle
   * through `channels/server/service-writes-members.ts › updateMyMemberSettings`
   * — the SAME write the workspace channels page makes, so pinning on /home and
   * bookmarking on the channels page are the same act on the same row.
   * ⚠ **IT REPLACED A PER-DEVICE `localStorage` SET** (`dopl.home.channels.pinned`,
   * alive for one afternoon) that this ruling deleted: a pin nobody else could see
   * and that did not survive a second machine was the wrong model, and Samuel's
   * own screenshot named the control that already held the right one.
   *
   * 🔒 **ONE WIRE NAME FOR `channel_members.favorited_at`, AND IT IS THIS ONE
   * (Samuel's ruling R-27, 2026-09-17).** It was `favoritedAt` here and
   * `myFavoritedAt` on `channels/types.ts › Channel` — two names for one column,
   * which is the whole of the pin bug Samuel reported on 2026-09-15. The `my*`
   * prefix is what survives: it states the caller-relativity an ACCOUNT-WIDE
   * payload stops being able to assume.
   *
   * 🔒 ⚠ **EVERY READ SPELLS `?? null` INLINE (INVARIANTS §8)** — the key is new
   * under this name, so an entry written by the previous bundle carries the old
   * one and nothing under this. `null` is the fail-safe: the row files under its
   * own recency instead of appearing in **Pinned**.
   */
  myFavoritedAt: string | null;
  /**
   * 🔒 **THE CALLER'S OWN ROLE IN THIS CONTAINER — `workspace_members.role`,
   * caller-relative like `unread`, and carrying no `my*` prefix for the reason
   * `unread` does not (a home payload is only ever the caller's own).**
   * Added 2026-09-17, closing F-343.
   *
   * ⚠ **IT IS THE SAME ROLE VOCABULARY AND THE SAME LADDER THE WORKSPACE USES**
   * — `workspaces/types.ts › Role` (`@dopl/contracts › WorkspaceRole`) read
   * through `meetsMinRole`, never a second predicate and never a boolean pair.
   * A claimed link seats its peer at the link's `granted_role` (default `guest`,
   * ceiling `member`), so a container really does hold readers of three
   * different ranks and `"owner"` is true only of the person who MADE it.
   *
   * 🔒 **IT IS A PICTURE OF THE SERVER'S ANSWER, NOT A FENCE.** Every write on
   * this surface is floored server-side already (`POST /api/knowledge/bases` and
   * `POST /api/agent-templates` at `member`, `mintContainerLink` at `member`
   * plus grant-above-self, `canManageChannel` for the header). What this field
   * buys is that /home stops OFFERING what the server will refuse — INVARIANTS
   * §5's dead-control rule. **Do not read it as permission to drop a fence.**
   *
   * 🔒 ⚠ **NEW KEY ON AN INDEXEDDB-PERSISTED PAYLOAD — EVERY READ SPELLS
   * `?? EMPTY_ROLE` INLINE (INVARIANTS §8).** `GET /api/home/channels` is cached
   * with a 24h `gcTime`, so an entry written by the previous bundle survives the
   * upgrade WITHOUT this key; `EMPTY_ROLE` carries why the fail-safe is `guest`.
   */
  role: Role;
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

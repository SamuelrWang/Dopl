import type { AvatarPerson } from "@/shared/ui/avatar";
import type { HomeChannelRowFace } from "@/shared/ui/home-channel-row";
import type {
  Channel,
  ChannelDirectPeer,
  ChannelMember,
  ChannelPeer,
} from "../types";

/**
 * Pure display helpers shared by the sidebar and the thread header so DM
 * rendering stays consistent across both. A direct channel renders its
 * resolved peer's name + avatar; a normal channel keeps its stored name and
 * the hash glyph.
 *
 * The peer of a direct channel is normally carried on `c.directPeer` (resolved
 * server-side from the roster). When that resolution is missing (`directPeer`
 * is null), the header would fall back to a bare "Direct message" label with no
 * avatar — the "black placeholder" bug. The `members`/`currentUserId` optional
 * args let a caller recover the peer from the already-loaded channel roster, so
 * the real name + avatar still render.
 */

/**
 * 🔒 **THE CHANNEL-CREATION ROW'S LABEL — ONE DECLARATION, BOTH INFO BODIES
 * (Samuel's ruling R-20, 2026-09-17).**
 *
 * The workspace tab said **"Date of creation"** with `formatShortDate` and /home's
 * said **"Created"** with `formatDate` — three differences on one row (label,
 * formatter, source) with nothing recording a decision either way. R-20 is (a):
 * **"Created" + `formatDate` on both.**
 *
 * ⚠ **A CONSTANT RATHER THAN THE STRING TWICE, AND THAT IS THE POINT OF THE
 * RULING.** Two literals is exactly how the divergence happened: each body was
 * edited on its own day by somebody who could not see the other. The FORMATTER is
 * `shared/lib/format-time.ts › formatDate` — already one declaration — so the
 * label was the half with no single home. ⚠ `formatShortDate` drops the YEAR,
 * which on a creation date is the one component that matters; it is still the
 * right answer for recency stamps, and nothing else about it changed.
 *
 * ⚠ **THE THREAD INFO TAB READS THIS CONSTANT TOO SINCE 2026-09-17, AND ONLY
 * BECAUSE SAMUEL RULED IT DOES** (`components/thread-info-tab.tsx`). R-20 ruled on
 * the two CHANNEL bodies alone, so the thread's row — same column, one selection
 * away, same `Calendar` glyph — was left saying "Date of creation" with
 * `formatShortDate` and recorded as **F-722** rather than swept. Samuel answered
 * F-722 **yes** on 2026-09-17: the thread row takes "Created" + `formatDate` as
 * well. ⚠ **THE PROCESS IS THE POINT, NOT THE OUTCOME** — extending a ruling to a
 * surface it did not name is the failure the visual-match rules exist to prevent,
 * so the third importer arrived through a ticket and a word, never through a
 * sweep. A FOURTH surface needs the same, not this precedent.
 *
 * ⚠ **THE SOURCE IS STILL THE HOST'S** (`channel.createdAt` vs
 * `homeChannel.createdAt` — the same column, projected twice); collapsing that is
 * the ONE-BODY step, not this one.
 */
export const CREATED_ROW_LABEL = "Created";

/**
 * How a human is NAMED in this feature's UI: display name, then email, then
 * the raw user id as a last resort so a row is never blank.
 *
 * THE ONE definition — the address picker's selected/menu rows and the
 * composer's @-mention candidates both read from here. They had drifted into
 * two identical private copies, which is two places for the fallback order to
 * change independently (and a mention that inserts a different string than the
 * picker shows is a user-visible mismatch, not a cosmetic one).
 */
/**
 * ⚠ TRIMMED, AND THE TRIM IS A PARITY FIX RATHER THAN A TIDY-UP (2026-09-07).
 *
 * `||` already caught the empty string, but NOT a display name that is only whitespace — and the
 * HANDLE side of this same picker has trimmed since it was written: `lib/mentions.ts › handlesOf`
 * does `(source ?? "").trim()` and skips a source that empties, so a whitespace-named member
 * already claims their EMAIL handles and nothing else. The two sides had therefore already
 * diverged: the row rendered blank while {@link import("./mentions").insertableHandle} inserted a
 * working email handle under it. Trimming here is what closes that, not what risks opening it —
 * the picker's label and the token it inserts now come from sources that agree about what counts
 * as a name. Pinned in `blank-name-fallback.test.ts`.
 */
export function memberLabel(m: ChannelMember): string {
  return (m.displayName ?? "").trim() || (m.email ?? "").trim() || m.userId;
}

/** The other member of a direct channel, from the roster; null when unknown. */
function rosterPeer(
  members: ChannelMember[] | undefined,
  currentUserId: string | undefined
): ChannelMember | null {
  if (!members || !currentUserId) return null;
  return members.find((m) => m.userId !== currentUserId) ?? null;
}

/**
 * The name to show for a channel: the peer's name for a DM, else `c.name`.
 * For a DM with an unresolved `directPeer`, falls back to the roster peer's
 * name (when `members`/`currentUserId` are supplied) before the literal
 * "Direct message".
 */
export function channelDisplayName(
  c: Channel,
  members?: ChannelMember[],
  currentUserId?: string
): string {
  if (c.isDirect) {
    if (c.directPeer?.displayName) return c.directPeer.displayName;
    const peer = rosterPeer(members, currentUserId);
    // ⚠ `memberLabel`, NOT A SECOND FALLBACK CHAIN (2026-09-07). This line read
    // `peer?.displayName ?? peer?.email ?? "Direct message"`, and `??` falls back only on null
    // and undefined — so a peer whose display name is the EMPTY STRING returned "", and the DM
    // rendered with no name at all in the sidebar and the header. That is the exact invariant
    // {@link memberLabel} exists to hold ("so a row is never blank", eleven lines up), restated
    // here in a weaker operator: the same drift-into-a-private-copy this file's own docblock
    // warns about. The literal stays for the case it was actually written for — a peer that
    // cannot be resolved from either source.
    return peer ? memberLabel(peer) : "Direct message";
  }
  return c.name;
}

/**
 * The person to render an avatar for: the peer of a direct channel, else null
 * (a normal channel keeps its hash glyph rather than a person avatar).
 */
export function channelDisplayAvatarPerson(c: Channel): ChannelDirectPeer | null {
  return c.isDirect ? c.directPeer : null;
}

/**
 * The peer person to render for a DM avatar, resolved defensively: prefers the
 * server-resolved `c.directPeer`, then falls back to the roster peer (the one
 * member that is not the current user). Returns an {@link AvatarPerson} so the
 * caller can pass it straight to {@link Avatar}; null only when the channel is
 * not direct or the peer cannot be resolved from either source. A null result
 * still lets the header render an initials-fallback avatar rather than a bare
 * placeholder.
 */
export function channelDisplayPeerPerson(
  c: Channel,
  members?: ChannelMember[],
  currentUserId?: string
): AvatarPerson | null {
  if (!c.isDirect) return null;
  if (c.directPeer) {
    return {
      userId: c.directPeer.userId,
      email: null,
      displayName: c.directPeer.displayName,
      avatarUrl: c.directPeer.avatarUrl,
    };
  }
  const peer = rosterPeer(members, currentUserId);
  if (!peer) return null;
  return {
    userId: peer.userId,
    email: peer.email,
    displayName: peer.displayName,
    avatarUrl: peer.avatarUrl,
  };
}

/**
 * THE PEOPLE ON A CHANNEL ROW, in {@link AvatarStack}'s shape — **the ONE
 * peer→face derivation, read by both surfaces (Wave 4, U28).**
 *
 * ⚠ **IT IS A DERIVATION, WHICH IS WHY IT IS HERE AND NOT ON THE ROW.**
 * `shared/ui/home-channel-row.tsx` takes ANSWERS and forbids derivation moving
 * in; the workspace sidebar row takes the same answers. Two hosts computing one
 * fallback chain is how the two rosters come to name a member differently.
 * ⚠ **`displayName` IS NON-NULL** — `AvatarStack` initials and titles it, so a
 * nameless member degrades to their address exactly as `Avatar`'s own fallback
 * does, never to "?".
 * ⚠ **NO `?? EMPTY_PEERS` IN HERE (INVARIANTS §8).** The cache fallback belongs
 * to whoever reads the cached payload; applied twice it is a fallback nobody can
 * audit.
 */
export function channelRowFaces(
  peers: readonly ChannelPeer[]
): HomeChannelRowFace[] {
  return peers.map((person) => ({
    userId: person.userId,
    displayName: person.displayName ?? person.email ?? "Member",
    avatarUrl: person.avatarUrl,
  }));
}

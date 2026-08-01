import type { AvatarPerson } from "@/shared/ui/avatar";
import type { Channel, ChannelDirectPeer, ChannelMember } from "../types";

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
 * How a human is NAMED in this feature's UI: display name, then email, then
 * the raw user id as a last resort so a row is never blank.
 *
 * THE ONE definition — the address picker's selected/menu rows and the
 * composer's @-mention candidates both read from here. They had drifted into
 * two identical private copies, which is two places for the fallback order to
 * change independently (and a mention that inserts a different string than the
 * picker shows is a user-visible mismatch, not a cosmetic one).
 */
export function memberLabel(m: ChannelMember): string {
  return m.displayName || m.email || m.userId;
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
    return peer?.displayName ?? peer?.email ?? "Direct message";
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

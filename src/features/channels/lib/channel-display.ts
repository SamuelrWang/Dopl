import type { Channel, ChannelDirectPeer } from "../types";

/**
 * Pure display helpers shared by the sidebar (T2) and the thread header (T3)
 * so DM rendering stays consistent across both. A direct channel renders its
 * resolved peer's name + avatar; a normal channel keeps its stored name and
 * the hash glyph.
 */

/** The name to show for a channel: the peer's name for a DM, else `c.name`. */
export function channelDisplayName(c: Channel): string {
  if (c.isDirect) {
    return c.directPeer?.displayName ?? "Direct message";
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

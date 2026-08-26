import { describe, expect, it } from "vitest";
import {
  channelDisplayAvatarPerson,
  channelDisplayName,
  channelDisplayPeerPerson,
} from "./channel-display";
import { EMPTY_INFO_CARD } from "../info-card";
import type { Channel, ChannelDirectPeer, ChannelMember } from "../types";

const ME = "me";
const PEER = "peer";

/** Minimal Channel factory — only the fields the display helpers read. */
function chan(over: Partial<Channel> = {}): Channel {
  return {
    id: "c1",
    workspaceId: "w1",
    slug: "c1",
    name: "general",
    topic: "",
    visibility: "private",
    isDirect: false,
    directPeer: null,
    createdBy: ME,
    archivedAt: null,
    createdAt: "2026-07-01T00:00:00.000Z",
    updatedAt: "2026-07-01T00:00:00.000Z",
    memberCount: 2,
    lastMessageAt: null,
    role: "owner",
    isMember: true,
    lastReadAt: null,
    unread: false,
    myNotifyScope: "all",
    myAgentToolProfile: "full",
    myFavoritedAt: null,
    onlineMemberCount: 0,
    infoCard: EMPTY_INFO_CARD,
    ...over,
  };
}

/** Minimal ChannelMember factory. */
function member(over: Partial<ChannelMember> & { userId: string }): ChannelMember {
  return {
    channelId: "c1",
    role: "member",
    workspaceRole: null,
    lastReadAt: null,
    notifyScope: null,
    agentToolProfile: null,
    favoritedAt: null,
    agentOnline: false,
    lastSeenAt: null,
    addedBy: null,
    joinedAt: "2026-07-01T00:00:00.000Z",
    displayName: null,
    email: null,
    avatarUrl: null,
    ...over,
  };
}

const directPeer: ChannelDirectPeer = {
  userId: PEER,
  displayName: "Ada Lovelace",
  avatarUrl: "https://example.test/ada.png",
};

const roster: ChannelMember[] = [
  member({ userId: ME, displayName: "Me" }),
  member({
    userId: PEER,
    displayName: "Roster Ada",
    email: "ada@example.test",
    avatarUrl: "https://example.test/roster-ada.png",
  }),
];

describe("channelDisplayPeerPerson", () => {
  it("prefers the resolved directPeer when present", () => {
    const c = chan({ isDirect: true, directPeer });
    expect(channelDisplayPeerPerson(c, roster, ME)).toEqual({
      userId: PEER,
      email: null,
      displayName: "Ada Lovelace",
      avatarUrl: "https://example.test/ada.png",
    });
  });

  it("falls back to the roster peer when directPeer is null", () => {
    const c = chan({ isDirect: true, directPeer: null });
    expect(channelDisplayPeerPerson(c, roster, ME)).toEqual({
      userId: PEER,
      email: "ada@example.test",
      displayName: "Roster Ada",
      avatarUrl: "https://example.test/roster-ada.png",
    });
  });

  it("returns null when directPeer is null and the roster is unavailable", () => {
    const c = chan({ isDirect: true, directPeer: null });
    expect(channelDisplayPeerPerson(c)).toBeNull();
    expect(channelDisplayPeerPerson(c, [], ME)).toBeNull();
  });

  it("returns null for a non-direct channel", () => {
    expect(channelDisplayPeerPerson(chan(), roster, ME)).toBeNull();
  });
});

describe("channelDisplayName", () => {
  it("uses the directPeer name for a DM", () => {
    const c = chan({ isDirect: true, directPeer });
    expect(channelDisplayName(c)).toBe("Ada Lovelace");
  });

  it("falls back to the roster peer name when directPeer is null", () => {
    const c = chan({ isDirect: true, directPeer: null });
    expect(channelDisplayName(c, roster, ME)).toBe("Roster Ada");
  });

  it("falls back to the literal string when nothing resolves", () => {
    const c = chan({ isDirect: true, directPeer: null });
    expect(channelDisplayName(c)).toBe("Direct message");
  });

  it("uses the stored name for a normal channel", () => {
    expect(channelDisplayName(chan({ name: "general" }))).toBe("general");
  });
});

describe("channelDisplayAvatarPerson (unchanged sidebar helper)", () => {
  it("returns the directPeer for a DM, null otherwise", () => {
    expect(channelDisplayAvatarPerson(chan({ isDirect: true, directPeer }))).toEqual(
      directPeer
    );
    expect(channelDisplayAvatarPerson(chan())).toBeNull();
  });
});

/**
 * Channels v2 — row builders shared by this folder's component tests.
 *
 * ⚠ NOT a product fixture. Nothing here is imported by a component; it exists so
 * three test files describe a channel, a member, a message and a thread once
 * instead of three times, and so a DTO field added later breaks one file rather
 * than drifting silently in three.
 */

import { EMPTY_INFO_CARD } from "../../info-card";
import { EMPTY_AGENT_POSTURE } from "../../lib/agent-posture";
import type {
  Channel,
  ChannelMember,
  ChannelMention,
  ChannelMessage,
  ChannelThread,
} from "../../types";

export const WS = "ws-1";
export const CHANNEL_ID = "ch-1";
export const ME = "u-me";
export const PEER = "u-peer";

export function channel(over: Partial<Channel> = {}): Channel {
  return {
    id: CHANNEL_ID,
    workspaceId: WS,
    slug: "website",
    name: "Website",
    topic: "The redesign",
    visibility: "private",
    isDirect: false,
    directPeer: null,
    createdBy: ME,
    archivedAt: null,
    createdAt: "2026-08-01T10:00:00.000Z",
    updatedAt: "2026-08-01T10:00:00.000Z",
    memberCount: 2,
    lastMessageAt: "2026-08-18T12:00:00.000Z",
    role: "owner",
    isMember: true,
    lastReadAt: null,
    unread: false,
    myNotifyScope: null,
    myAgentToolProfile: "full",
    /** ⚠ Defaults to NOT favourited — the state the sidebar's Favorites
     *  section must be absent in, and the one a bookmark toggle starts from. */
    myFavoritedAt: null,
    onlineMemberCount: 1,
    infoCard: EMPTY_INFO_CARD,
    agentPosture: EMPTY_AGENT_POSTURE,
    defaultResponderAgentName: null,
    ...over,
  };
}

export function member(over: Partial<ChannelMember> = {}): ChannelMember {
  return {
    channelId: CHANNEL_ID,
    userId: ME,
    role: "owner",
    workspaceRole: null,
    lastReadAt: null,
    notifyScope: null,
    agentToolProfile: "full",
    favoritedAt: null,
    agentOnline: true,
    lastSeenAt: new Date().toISOString(),
    addedBy: null,
    joinedAt: "2026-08-01T10:00:00.000Z",
    displayName: "Sam Wang",
    email: "sam@example.com",
    avatarUrl: null,
    ...over,
  };
}

export function message(over: Partial<ChannelMessage> = {}): ChannelMessage {
  return {
    id: "m-1",
    seq: 1,
    channelId: CHANNEL_ID,
    authorUserId: ME,
    authorKind: "user",
    kind: "message",
    body: "hello there",
    metadata: {},
    clientMsgId: null,
    createdAt: "2026-08-18T12:00:00.000Z",
    authorName: "Sam Wang",
    authorAvatarUrl: null,
    ...over,
  };
}

/** One row of the Tags inbox projection. ⚠ Defaults to UNREAD and to a
 *  channel-level post — the two states the inbox's interaction is about. */
export function mention(over: Partial<ChannelMention> = {}): ChannelMention {
  return {
    messageId: "m-1",
    seq: 1,
    channelId: CHANNEL_ID,
    threadId: null,
    authorUserId: PEER,
    authorKind: "user",
    authorName: "Diana Taylor",
    authorAvatarUrl: null,
    snippet: "can you take a look at this before the freeze?",
    createdAt: "2026-08-18T12:00:00.000Z",
    read: false,
    ...over,
  };
}

export function thread(over: Partial<ChannelThread> = {}): ChannelThread {
  return {
    id: "t-1",
    channelId: CHANNEL_ID,
    workspaceId: WS,
    title: "UI-kit design",
    status: "open",
    outcome: null,
    mode: "interactive",
    createdBy: ME,
    targetUserId: PEER,
    createdAt: "2026-08-17T10:00:00.000Z",
    updatedAt: "2026-08-17T10:00:00.000Z",
    closedAt: null,
    outcomeSummary: null,
    lastActivityAt: new Date().toISOString(),
    ...over,
  };
}

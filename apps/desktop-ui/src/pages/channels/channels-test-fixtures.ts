/**
 * Channels page fixtures — the rows `index.test.tsx` serves over its `fetch`
 * stub.
 *
 * ⚠ §1 SPLIT (2026-08-25). That suite stood at EXACTLY 500 lines and the
 * info-card field pushed it to 502; INVARIANTS §1 is explicit that an edit to a
 * file at the cap is a SPLIT, not a comment deletion. This is the same seam the
 * home suite took when `index.test.tsx` hit the cap (`pages/home/
 * home-test-harness.tsx`) and for the same reason: fixtures are DATA about what
 * a channel looks like, and the suite is the behaviour.
 *
 * ⚠ `workspaceId` DID NOT MOVE. It is mutable per-test state (a fresh id per
 * mount, so the realtime registry cannot hand the second test the first test's
 * connected entry), and it stays where the tests that assign it live. What is
 * here is only what is CONSTANT — every row carries `workspaceId: ""` and its
 * call site spreads the live one over it.
 */

import { EMPTY_INFO_CARD } from "@/features/channels/info-card";
import type {
  Channel,
  ChannelConsentRequest,
  ChannelMember,
  ChannelMessage,
} from "@/features/channels/types";

export const CHANNEL_ID = "ch-1";
export const OTHER_ID = "ch-2";

export const baseChannel: Channel = {
  id: CHANNEL_ID,
  workspaceId: "",
  slug: "migration",
  name: "migration",
  topic: "Desktop port",
  visibility: "private",
  isDirect: false,
  directPeer: null,
  createdBy: "u-1",
  archivedAt: null,
  createdAt: "2026-08-01T10:00:00.000Z",
  updatedAt: "2026-08-01T10:00:00.000Z",
  memberCount: 2,
  lastMessageAt: "2026-08-01T12:00:00.000Z",
  role: "owner",
  isMember: true,
  lastReadAt: null,
  unread: false,
  myNotifyScope: "all",
  myAgentToolProfile: "full",
  myFavoritedAt: null,
  infoCard: EMPTY_INFO_CARD,
  onlineMemberCount: 1,
};

export const OTHER: Channel = {
  ...baseChannel,
  id: OTHER_ID,
  slug: "brand",
  name: "brand",
  topic: "Brand work",
};

export const MESSAGES: ChannelMessage[] = [
  {
    id: "m-1",
    seq: 1,
    channelId: CHANNEL_ID,
    authorUserId: "u-2",
    authorKind: "user",
    kind: "message",
    body: "Can your agent take the channels port?",
    metadata: { taskId: "t-1" },
    clientMsgId: null,
    createdAt: "2026-08-01T11:59:00.000Z",
    authorName: "Ada",
    authorAvatarUrl: null,
  },
  {
    id: "m-2",
    seq: 2,
    channelId: CHANNEL_ID,
    authorUserId: "u-1",
    authorKind: "agent",
    kind: "message",
    body: "Picked it up, wiring the client queries now.",
    metadata: {},
    clientMsgId: null,
    createdAt: "2026-08-01T12:00:00.000Z",
    authorName: "Sam",
    authorAvatarUrl: null,
  },
];

export const MEMBERS: ChannelMember[] = [
  {
    channelId: CHANNEL_ID,
    userId: "u-1",
    role: "owner",
    lastReadAt: null,
    notifyScope: "all",
    agentToolProfile: "full",
    favoritedAt: null,
    agentOnline: true,
    lastSeenAt: "2026-08-01T12:00:00.000Z",
    addedBy: null,
    joinedAt: "2026-08-01T10:00:00.000Z",
    displayName: "Sam",
    email: "sam@example.com",
    avatarUrl: null,
  },
  {
    channelId: CHANNEL_ID,
    userId: "u-2",
    role: "member",
    lastReadAt: null,
    notifyScope: null,
    agentToolProfile: null,
    favoritedAt: null,
    agentOnline: false,
    lastSeenAt: null,
    addedBy: "u-1",
    joinedAt: "2026-08-01T10:05:00.000Z",
    displayName: "Ada",
    email: "ada@example.com",
    avatarUrl: null,
  },
];

/** ONE thread on the primary channel — the pop-out's landing needs something real
 *  to select, and the `?thread=` case below is the whole reason it is here. */
export const THREAD_ID = "t-1";
export const THREAD = {
  id: THREAD_ID,
  channelId: CHANNEL_ID,
  workspaceId: "",
  title: "Ship the release",
  status: "open",
  outcome: null,
  mode: "collab",
  createdBy: "u-1",
  targetUserId: null,
  createdAt: "2026-08-01T11:00:00.000Z",
  updatedAt: "2026-08-01T11:00:00.000Z",
  closedAt: null,
  outcomeSummary: null,
  lastActivityAt: "2026-08-01T12:00:00.000Z",
};

/** ⚠ AN OUTBOUND DRAFT NOW (2026-08-22). It was `kind: "inbound"` — a teammate's
 *  agent asking to run here — and that whole lane is deleted. What is left to
 *  decide is the operator's OWN agent's reply, waiting on their Send. */
export const CONSENT: ChannelConsentRequest = {
  id: "cr-1",
  channelId: CHANNEL_ID,
  workspaceId: "",
  operatorUserId: "u-1",
  requesterUserId: null,
  kind: "outbound",
  messageSeq: 1,
  summary: "Reply about the channels port",
  bodyPreview: "",
  proposedReply: "Yes — starting on the client queries now.",
  status: "pending",
  decidedBy: null,
  decidedAt: null,
  createdAt: "2026-08-01T12:01:00.000Z",
  expiresAt: null,
  requesterName: null,
  requesterAvatarUrl: null,
};

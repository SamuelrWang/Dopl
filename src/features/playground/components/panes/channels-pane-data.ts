import { formatChannelTimestamp } from "@/shared/lib/format-time";

/**
 * Data source for the playground Channels pane: the static demo content that
 * renders before a session exists, plus the mapping from the REAL channels
 * wire DTOs (GET `/api/channels`, GET `/api/channels/[channelId]/messages`;
 * shapes: `features/channels/types.ts › Channel` / `ChannelMessage`) into the
 * pane's own display shape, so the JSX renders both identically.
 */

export interface DemoMessage {
  id: string;
  author: string;
  /** Renders the agent pill + left side; a human row sides on `own`. */
  kind: "agent" | "user";
  /** Viewer's own human message — right-aligned, no avatar. */
  own?: boolean;
  time: string;
  body: string;
}

export interface DemoChannel {
  id: string;
  name: string;
  isDirect: boolean;
  visibility: "public" | "private";
  memberCount: number;
  topic: string;
  time: string;
  unread?: boolean;
  onlineCount: number;
  members: { userId: string; displayName: string; online: boolean }[];
  messages: DemoMessage[];
}

const YOU = { userId: "u-you", displayName: "Samuel Wang", online: true };
const ADA = { userId: "u-ada", displayName: "Ada Chen", online: true };
const MARCO = { userId: "u-marco", displayName: "Marco Ruiz", online: false };
const JUN = { userId: "u-jun", displayName: "Jun Park", online: false };

type Kind = DemoMessage["kind"];
function msg(
  id: string, author: string, kind: Kind, time: string, body: string, own?: boolean
): DemoMessage {
  return { id, author, kind, time, body, own };
}

export const DEMO_CHANNELS: DemoChannel[] = [
  {
    id: "dm-ada",
    name: "Ada Chen",
    isDirect: true,
    visibility: "private",
    memberCount: 2,
    topic: "",
    time: "Yesterday",
    onlineCount: 1,
    members: [YOU, ADA],
    messages: [
      msg("d1", "Ada Chen", "user", "Yesterday",
        "Can your agent pull the launch checklist into the playground?"),
      msg("d2", "Samuel's agent", "agent", "Yesterday",
        "Checklist synced. 12 items, 3 still open — posted the summary in #general."),
    ],
  },
  {
    id: "ch-general",
    name: "general",
    isDirect: false,
    visibility: "public",
    memberCount: 4,
    topic: "Agent-to-agent coordination",
    time: "9:42 AM",
    onlineCount: 2,
    members: [YOU, ADA, MARCO, JUN],
    messages: [
      msg("g1", "Samuel's agent", "agent", "9:40 AM",
        "Connected to the playground workspace. Watching this channel for requests."),
      msg("g2", "Ada's agent", "agent", "9:41 AM",
        "Acknowledged. Indexed 42 documents from the knowledge base — ready for retrieval."),
      msg("g3", "Samuel Wang", "user", "9:42 AM",
        "Nice — route new questions through here and open a thread per task.", true),
    ],
  },
  {
    id: "ch-launch",
    name: "launch-planning",
    isDirect: false,
    visibility: "private",
    memberCount: 3,
    topic: "Ship week logistics",
    time: "Mon",
    unread: true,
    onlineCount: 0,
    members: [{ ...YOU, online: false }, MARCO, JUN],
    messages: [
      msg("l1", "Marco's agent", "agent", "Mon",
        "Draft announcement is in the knowledge base under Launch / Copy. Two open questions flagged."),
    ],
  },
];

/** Wire subset of `Channel` this pane consumes (list DTO of GET /api/channels). */
export interface LiveChannel {
  id: string;
  name: string;
  topic: string;
  visibility: "public" | "private";
  isDirect: boolean;
  directPeer: {
    userId: string;
    displayName: string | null;
    avatarUrl: string | null;
  } | null;
  memberCount: number;
  lastMessageAt: string | null;
  unread: boolean;
  onlineMemberCount: number;
}

/** Wire subset of `ChannelMessage` (GET /api/channels/[channelId]/messages). */
export interface LiveMessage {
  id: string;
  authorUserId: string | null;
  authorKind: "user" | "agent" | "system";
  body: string;
  createdAt: string;
  authorName: string | null;
}

export interface ChannelListResponse {
  channels: LiveChannel[];
}

export interface MessageListResponse {
  messages: LiveMessage[];
}

export function toDemoMessage(m: LiveMessage): DemoMessage {
  return {
    id: m.id,
    author: m.authorName ?? (m.authorKind === "system" ? "System" : "Member"),
    // The pane's bubbles know two authors: humans and everything else. A
    // system row wears the agent treatment rather than growing a third look.
    kind: m.authorKind === "user" ? "user" : "agent",
    time: formatChannelTimestamp(m.createdAt),
    body: m.body,
  };
}

/**
 * List DTO → display shape. The list read carries no roster, so `members` is
 * just the resolved DM peer (the AvatarStack simply renders fewer faces);
 * `messages` is filled by the caller for the selected channel only.
 */
export function toDemoChannel(
  c: LiveChannel,
  messages: DemoMessage[]
): DemoChannel {
  return {
    id: c.id,
    name: c.isDirect ? (c.directPeer?.displayName ?? c.name) : c.name,
    isDirect: c.isDirect,
    visibility: c.visibility,
    memberCount: c.memberCount,
    topic: c.topic,
    time: c.lastMessageAt ? formatChannelTimestamp(c.lastMessageAt) : "",
    unread: c.unread,
    onlineCount: c.onlineMemberCount,
    members: c.directPeer
      ? [{
          userId: c.directPeer.userId,
          displayName: c.directPeer.displayName ?? "Member",
          online: c.onlineMemberCount > 0,
        }]
      : [],
    messages,
  };
}

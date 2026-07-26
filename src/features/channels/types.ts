/**
 * Channels feature — camelCase domain types.
 *
 * A channel is a shared workspace thread where humans and their agents
 * post messages and structured activity events. Distinct from chats (a
 * private per-owner archive), a channel has an explicit membership set:
 * PUBLIC channels are visible to any workspace member, PRIVATE ones only
 * to their members.
 */

/** Private = members only. Public = any workspace member can read/join. */
export type ChannelVisibility = "private" | "public";

/** Channel-scoped role: the creator is `owner`, everyone added is `member`. */
export type ChannelRole = "owner" | "member";

/** Who wrote a message: a human, an agent (MCP/CLI), or the system. */
export type MessageAuthorKind = "user" | "agent" | "system";

/**
 * Message kind. `message` = chat; the `task_*` values are structured
 * activity events (payload in `metadata`, human-readable render in
 * `body`); `system` = joins / topic changes.
 */
export type ChannelMessageKind =
  | "message"
  | "task_started"
  | "task_progress"
  | "task_finished"
  | "task_failed"
  | "system";

/** List-level channel: header + caller-relative membership + activity. */
export type Channel = {
  id: string;
  workspaceId: string;
  slug: string;
  name: string;
  topic: string;
  visibility: ChannelVisibility;
  createdBy: string;
  archivedAt: string | null;
  createdAt: string;
  updatedAt: string;
  /** Count of members. */
  memberCount: number;
  /** ISO datetime of the latest message, null when the channel is empty. */
  lastMessageAt: string | null;
  /** The caller's channel role, null when they are not a member. */
  role: ChannelRole | null;
  /** True when the caller is a channel member. */
  isMember: boolean;
  /** The caller's last-read watermark, null when never read / not a member. */
  lastReadAt: string | null;
  /** True when there is a message newer than the caller's `lastReadAt`. */
  unread: boolean;
};

export type ChannelMessage = {
  id: string;
  /** Monotonic cursor — read / await paginate on `seq`. */
  seq: number;
  channelId: string;
  authorUserId: string | null;
  authorKind: MessageAuthorKind;
  kind: ChannelMessageKind;
  body: string;
  metadata: Record<string, unknown>;
  clientMsgId: string | null;
  createdAt: string;
  /** Hydrated author display (UI convenience); null for system rows. */
  authorName: string | null;
  authorAvatarUrl: string | null;
};

export type ChannelMember = {
  channelId: string;
  userId: string;
  role: ChannelRole;
  lastReadAt: string | null;
  addedBy: string | null;
  joinedAt: string;
  /** Hydrated profile fields for the roster. */
  displayName: string | null;
  email: string | null;
  avatarUrl: string | null;
};

/** Channel header + its transcript (detail read). */
export type ChannelDetail = Channel & { messages: ChannelMessage[] };

/** Long-poll result: new messages since a cursor + whether it timed out. */
export type AwaitResult = {
  messages: ChannelMessage[];
  timedOut: boolean;
};

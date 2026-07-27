/**
 * Channel types — cross-user, agent-to-agent collaboration threads.
 *
 * A channel is a shared in-workspace thread that agents (and users) post
 * to. Every message carries a monotonic `seq` cursor, so a listener can
 * long-poll for "everything after seq N" via `awaitMessages`. These mirror
 * the API DTO shapes (camelCase) in the app's `src/features/channels`.
 */

export type ChannelVisibility = "public" | "private";

export type ChannelMemberRole = "owner" | "member";

/** How a task runs. */
export type TaskMode = "interactive" | "autonomous";

/** Task lifecycle status. */
export type TaskStatus = "open" | "closed";

/** How a closed task ended. */
export type TaskOutcome = "completed" | "failed";

/**
 * Per-member notification scope for a channel (how loudly it notifies the
 * member's listener): `all` = addressed prompts + silent FYIs; `addressed` =
 * only addressed-to-me prompts; `none` = fully muted.
 */
export type NotifyScope = "all" | "addressed" | "none";

export type ChannelAuthorKind = "user" | "agent" | "system";

/**
 * Full message-kind set as stored in the DB. `message` = chat; the
 * `task_*` kinds are structured activity events (machine payload in
 * `metadata`, human-readable render in `body`); `system` = server-emitted
 * joins / topic changes (agents don't post these).
 */
export type ChannelMessageKind =
  | "message"
  | "task_started"
  | "task_progress"
  | "task_finished"
  | "task_failed"
  | "system";

export interface Channel {
  id: string;
  workspaceId: string;
  slug: string;
  name: string;
  topic: string;
  visibility: ChannelVisibility;
  /** True for a direct (1:1) channel between two members. */
  isDirect?: boolean;
  /** The resolved peer for a direct channel; null / absent for a normal one. */
  directPeer?: {
    userId: string;
    displayName: string | null;
    avatarUrl: string | null;
  } | null;
  createdBy: string;
  /** ISO datetime the channel was archived, or null when active. */
  archivedAt: string | null;
  createdAt: string;
  updatedAt: string;
  /** Present on list/get — number of channel members. */
  memberCount?: number;
  /** Present on list/get — ISO datetime of the latest message, or null. */
  lastMessageAt?: string | null;
  /** The caller's own notification scope, null when they are not a member. */
  myNotifyScope?: NotifyScope | null;
}

export interface ChannelMessage {
  id: string;
  /** Monotonic cursor — `read`/`await` return messages with a higher seq. */
  seq: number;
  channelId: string;
  authorUserId: string | null;
  authorKind: ChannelAuthorKind;
  kind: ChannelMessageKind;
  body: string;
  metadata: Record<string, unknown>;
  clientMsgId: string | null;
  createdAt: string;
}

export interface ChannelMember {
  channelId: string;
  userId: string;
  role: ChannelMemberRole;
  lastReadAt: string | null;
  /** This member's own per-channel notification scope. */
  notifyScope?: NotifyScope;
  addedBy: string | null;
  joinedAt: string;
  displayName?: string | null;
  email?: string | null;
  avatarUrl?: string | null;
}

export interface ChannelCreateInput {
  name?: string;
  topic?: string;
  visibility?: ChannelVisibility;
  /** Open a direct (1:1) channel with `memberUserId` instead of a named one. */
  direct?: boolean;
  /** The peer's user id — required (and only used) when `direct` is true. */
  memberUserId?: string;
}

/**
 * A first-class channel task: a titled, mode-tagged unit of work whose
 * transcript rides on `channel_messages` (metadata.taskId = ChannelTask.id).
 */
export interface ChannelTask {
  id: string;
  channelId: string;
  workspaceId: string;
  title: string;
  status: TaskStatus;
  outcome: TaskOutcome | null;
  mode: TaskMode;
  createdBy: string;
  targetUserId: string | null;
  createdAt: string;
  updatedAt: string;
  closedAt: string | null;
}

export interface ChannelTaskCreateInput {
  title: string;
  mode?: TaskMode;
  body: string;
  toUserId: string;
}

export interface ChannelMessageInput {
  body: string;
  kind?: ChannelMessageKind;
  metadata?: Record<string, unknown>;
  authorKind?: ChannelAuthorKind;
  clientMsgId?: string;
  /**
   * Addressing (v1.1): the user id of the channel member this message
   * targets. The route validates it is an active member and stores it in
   * `metadata.to_user_id`; a listener triggers only on messages addressed
   * to it (or, in a 2-member channel, the implicit other member).
   */
  toUserId?: string;
  /** One-line intent (<=200 chars) surfaced in the receiver's notification. */
  summary?: string;
}

export interface ReadMessagesOptions {
  /** Return only messages with seq greater than this. */
  since?: number;
  /** Max messages to return (server caps at 200). */
  limit?: number;
}

export interface AwaitMessagesOptions {
  /** The last seq the caller has processed — poll for seq greater than it. */
  since: number;
  /** How long the server long-polls before returning `timedOut` (ms). */
  timeoutMs?: number;
}

/**
 * Result of a long-poll `awaitMessages` call: any messages that arrived
 * with seq > since, and whether the poll timed out with nothing new (in
 * which case `messages` is empty and the caller should re-poll with the
 * same `since`).
 */
export interface AwaitResult {
  messages: ChannelMessage[];
  timedOut: boolean;
}

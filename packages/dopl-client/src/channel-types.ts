/**
 * Channel types — cross-user, agent-to-agent collaboration.
 *
 * CHANNEL (or DM) holds many THREADS. A THREAD is ONE exchange between two
 * members, SHARED: both see the same thread, title, status. A SESSION is ONE
 * member's agent run on a thread, on that member's machine; each side has its
 * own, neither sees the other's. Messages carry a monotonic `seq` cursor →
 * `awaitMessages` long-polls past it. Mirrors the API DTOs (camelCase) in
 * `src/features/channels`.
 *
 * ⚠ BOUNDARY: wire/storage name `task` == domain name `thread`. Route paths
 * (`/api/channels/[channelId]/tasks/**`) and response field names (`tasks`,
 * `task`) are storage names, deliberately unchanged; mapping happens here and
 * in `channel.ts`.
 */

export type ChannelVisibility = "public" | "private";

export type ChannelMemberRole = "owner" | "member";

export type ThreadMode = "interactive" | "autonomous";

export type ThreadStatus = "open" | "closed";

export type ThreadOutcome = "completed" | "failed";

export type ChannelAuthorKind = "user" | "agent" | "system";

/**
 * `message` = chat; `task_*` = structured activity events (machine payload in
 * `metadata`, human render in `body`); `system` = server-emitted joins / topic
 * changes (agents don't post these).
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
  /** True for a direct (1:1) channel. */
  isDirect?: boolean;
  /** Resolved peer for a direct channel; null / absent otherwise. */
  directPeer?: {
    userId: string;
    displayName: string | null;
    avatarUrl: string | null;
  } | null;
  createdBy: string;
  /** ISO datetime archived, null when active. */
  archivedAt: string | null;
  createdAt: string;
  updatedAt: string;
  /** Present on list/get only. */
  memberCount?: number;
  /** Present on list/get only — ISO datetime of latest message, or null. */
  lastMessageAt?: string | null;
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
  /**
   * Hydrated author display. Lets a reader label who an agent acts FOR —
   * "agent for <authorName>" — so a counterparty is never mistaken for its own
   * operator. Null / absent on a system row or unresolved profile.
   */
  authorName?: string | null;
  authorAvatarUrl?: string | null;
}

/**
 * POST result: the stored message.
 *
 * ⚠ IT CARRIED ONE MORE FIELD, `threadClosed`, until thread closing was removed
 * (wiring plan Phase 4, 2026-08-18) — non-optional by construction, because the
 * server sent the key only on a post into a closed thread and an older
 * deployment sent none, and both had to read `false` rather than `undefined`.
 * That normalize-an-additive-field-to-a-value discipline still governs
 * `openingSeq`; this alias keeps the write result named apart from the read
 * shape so a future post-time notice has somewhere to go.
 */
export type ChannelMessagePosted = ChannelMessage;

export interface ChannelMember {
  channelId: string;
  userId: string;
  role: ChannelMemberRole;
  lastReadAt: string | null;
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
  /** Peer's user id — required, and only used, when `direct` is true. */
  memberUserId?: string;
}

/**
 * One titled, mode-tagged exchange; transcript rides on `channel_messages`
 * (`metadata.taskId` = ChannelThread.id — wire key keeps the storage name).
 */
export interface ChannelThread {
  id: string;
  channelId: string;
  workspaceId: string;
  title: string;
  /** ⚠ LEGACY, UNREAD — see {@link ThreadStatus}. Four fields, one story. */
  status: ThreadStatus;
  outcome: ThreadOutcome | null;
  mode: ThreadMode;
  createdBy: string;
  targetUserId: string | null;
  createdAt: string;
  updatedAt: string;
  closedAt: string | null;
  outcomeSummary: string | null;
  /**
   * When the thread last saw real activity — the newest message tagged for it,
   * or its own `createdAt` when nobody has posted into it. ⚠ NOT `updatedAt`,
   * which moves only when the ROW is patched.
   *
   * ⚠ ABSENT means THIS READ DID NOT DERIVE IT (`get_thread` loads one row and
   * does not), never "no activity". Only the thread LIST carries it, and the
   * list is ORDERED by it.
   */
  lastActivityAt?: string;
}

/**
 * One page of a channel's threads: the rows, most recently active first, plus
 * whether the server's ceiling clipped them.
 *
 * ⚠ `truncated` exists because threads never leave the list, so the read is
 * bounded and a clipped page that renders like an exhausted one asserts
 * something the read never established (INVARIANTS §9). Surface it; a caller
 * that drops it is claiming these are all of them.
 */
export interface ChannelThreadPage {
  threads: ChannelThread[];
  truncated: boolean;
}

/**
 * States a session's pill (and read-session-state) reports. NO `thinking` — it
 * needs streaming, which is off. Mirrors `SessionPillState` in the app.
 */
export type SessionPillState = "working" | "idle" | "ended";

/**
 * ONE of a member's live (or just-ended) sessions, from
 * `dopl_channel(op="read_sessions")`. Server-visible projection of the
 * desktop's `session-summary.list()`.
 */
export interface ChannelSessionState {
  channelId: string;
  /** Thread (task) this session is on, or null. */
  threadId: string | null;
  /** Friendly handle the pills show (flint / onyx / …). */
  name: string;
  state: SessionPillState;
  channelName: string | null;
  threadTitle: string | null;
  updatedAt: string;
}

export interface ChannelThreadCreateInput {
  title: string;
  mode?: ThreadMode;
  body: string;
  toUserId: string;
  /**
   * Idempotency key — re-sent create_thread with same id returns the existing
   * thread instead of double-creating it (and double-spawning the responder's
   * window). Mirrors `ChannelMessageInput.clientMsgId`.
   */
  clientMsgId?: string;
  /**
   * SPAWN-WITH-HANDOFF. Set by an EXTERNAL agent (Claude Desktop / Claude Code
   * over MCP): the session driving this thread opens ON THE OPERATOR'S MACHINE
   * instead of staying with the external session that created it. Absent/false
   * → an external create opens nothing there. Server stamps it onto the opening
   * message's reserved `metadata.handoff`, which the desktop reads.
   */
  handoff?: boolean;
}

/**
 * `createChannelThread` result: thread + `openingSeq`, the seq of the opening
 * request message the server posted — exactly the cursor the requester arms
 * `await` on. ⚠ Guessing it via `read limit=1` races the peer answering in
 * between: the "newest message" is then the reply, so the await starts one past
 * it and never sees what already arrived.
 *
 * `null` only for the idempotent short-circuit returning a thread created by
 * SOMEONE ELSE (no opening message).
 */
export interface ChannelThreadCreated {
  thread: ChannelThread;
  openingSeq: number | null;
}

/**
 * ⚠ TWO RESULT SHAPES ENDED HERE with thread closing (wiring plan Phase 4,
 * 2026-08-18): `ChannelThreadClosed` (thread + `echoSeq`, the seq of the
 * `task_finished` / `task_failed` marker a close posted) and
 * `ChannelThreadCloseProposed` (thread + `markerSeq` + the proposed outcome).
 *
 * The rule they both carried is live on {@link ChannelThreadCreated.openingSeq}
 * and is the reason they existed at all: **a write that also posts a message
 * hands its seq BACK.** Guessing one (last known seq + 1) once armed a hold past
 * a peer reply already in the channel and the wait never returned. `null` means
 * look it up, never "one past the last seq you saw".
 */

export interface ChannelMessageInput {
  body: string;
  kind?: ChannelMessageKind;
  metadata?: Record<string, unknown>;
  authorKind?: ChannelAuthorKind;
  clientMsgId?: string;
  /**
   * Target channel member. Route validates active membership and stores it in
   * `metadata.to_user_id`; a listener triggers only on messages addressed to it
   * (or, in a 2-member channel, the implicit other member).
   */
  toUserId?: string;
  /** One-line intent (<=200 chars) surfaced in the receiver's notification. */
  summary?: string;
  /**
   * Whether this post may reach anybody's agent. Absent = `request`.
   *
   *  - `request` — DM auto-address fires (a post into a direct channel with no
   *    `to` is addressed to the peer server-side), so the listener triggers.
   *    This is what makes a reply deliverable.
   *  - `chat` — HUMAN TALK. DM auto-address SKIPPED ENTIRELY: no `to_user_id`
   *    manufactured, so nothing on the far side reads it as an ask. Otherwise a
   *    normal message — seq, realtime, read watermark, `thread` tag.
   *
   * ⚠ `chat` + `toUserId` is a CONTRADICTION, refused 400
   * `CHANNEL_CHAT_ADDRESSED`, never silently resolved either way.
   * ⚠ Named agents (`toAgent` / `toAgents`) are gone; the server REFUSES those
   * fields rather than dropping them, so an old caller is told.
   */
  intent?: MessageIntent;
}

/**
 * `request` (default) reaches an agent; `chat` reaches only the humans in the
 * room. See `ChannelMessageInput.intent`.
 */
export type MessageIntent = "chat" | "request";

export interface ReadMessagesOptions {
  /** Only messages with seq greater than this. */
  since?: number;
  /** Server caps at 200. */
  limit?: number;
  /**
   * Scope the read to ONE thread — only messages tagged `metadata.taskId`. A
   * FILTER, not a lookup: an id nothing carries returns `[]`, not 404, and
   * legacy `task-<channelId>-<seq>` ids work as well as uuids. Composes with
   * `since` / `limit`.
   */
  thread?: string;
}

export interface AwaitMessagesOptions {
  /** Last seq the caller processed — poll for seq greater than it. */
  since: number;
  /** Server long-poll window before returning `timedOut` (ms). */
  timeoutMs?: number;
  /**
   * Messages by this user id neither end the poll nor appear in its result — a
   * caller posting while its own await is armed otherwise wakes on its own
   * echo. Unset watches every author.
   */
  excludeAuthor?: string;
}

/**
 * Long-poll result. `timedOut` → `messages` empty, caller re-polls with the
 * same `since`.
 */
export interface AwaitResult {
  messages: ChannelMessage[];
  timedOut: boolean;
}

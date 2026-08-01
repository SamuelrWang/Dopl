/**
 * Channel types — cross-user, agent-to-agent collaboration.
 *
 * A CHANNEL (or DM) holds many THREADS. A THREAD is ONE exchange between two
 * members about one thing — it may be a single message or a long piece of
 * work — and it is SHARED: both members see the same thread, its title, and
 * its status. A SESSION is ONE member's agent run working a thread, on THAT
 * member's machine; each side has its own, and neither sees the other's.
 *
 * Every message carries a monotonic `seq` cursor, so a listener can long-poll
 * for "everything after seq N" via `awaitMessages`. These mirror the API DTO
 * shapes (camelCase) in the app's `src/features/channels`.
 *
 * BOUNDARY: the wire/storage name `task` == the domain name `thread`. The
 * route paths (`/api/channels/[channelId]/tasks/**`) and the response field
 * names (`tasks`, `task`) are storage names and are deliberately unchanged;
 * the mapping happens here, in `channel.ts`.
 */

export type ChannelVisibility = "public" | "private";

export type ChannelMemberRole = "owner" | "member";

/** How a thread runs. */
export type ThreadMode = "interactive" | "autonomous";

/** Thread lifecycle status. */
export type ThreadStatus = "open" | "closed";

/** How a closed thread ended. */
export type ThreadOutcome = "completed" | "failed";

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
  /**
   * Hydrated author display (the API payload already carries these). Lets a
   * reader label who an agent is acting FOR — "agent for <authorName>" — so a
   * counterparty is never mistaken for its own operator. Null / absent for a
   * system row or when the profile is unresolved.
   */
  authorName?: string | null;
  authorAvatarUrl?: string | null;
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
 * A first-class channel thread: one titled, mode-tagged exchange whose
 * transcript rides on `channel_messages` (metadata.taskId = ChannelThread.id
 * — the wire key keeps the storage name).
 */
export interface ChannelThread {
  id: string;
  channelId: string;
  workspaceId: string;
  title: string;
  status: ThreadStatus;
  outcome: ThreadOutcome | null;
  mode: ThreadMode;
  createdBy: string;
  targetUserId: string | null;
  createdAt: string;
  updatedAt: string;
  closedAt: string | null;
  /** A human-readable close summary carried on the thread row; null while open
   *  or when closed without one. */
  outcomeSummary: string | null;
}

export interface ChannelThreadCreateInput {
  title: string;
  mode?: ThreadMode;
  body: string;
  toUserId: string;
  /**
   * Idempotency key — a re-sent create_thread with the same id returns the
   * already-created thread instead of double-creating it (and double-spawning
   * the responder's window). Mirrors `ChannelMessageInput.clientMsgId`.
   */
  clientMsgId?: string;
  /**
   * MULTIPLAYER: the EXTRA identities admitted to the thread — which is what
   * turns it into a BREAKOUT ROOM. The creator and `toUserId` are seeded by the
   * server, so this carries only the extras (max 20). Omitted (or empty) means
   * no participant rows at all, and the thread keeps the creator/target pair
   * gate — "has participants" is exactly what "is a breakout room" means.
   */
  participants?: ThreadParticipantRef[];
}

/**
 * MULTIPLAYER — an agent's lifecycle inside a channel. `summoned` = created,
 * not yet running; `active` = a session is working; `parked` = suspended but
 * resumable; `dismissed` = retired (the row survives, so the messages it
 * already authored keep their attribution and its handle stays taken).
 */
export type AgentStatus = "summoned" | "active" | "parked" | "dismissed";

/**
 * A first-class named agent inside a channel, summoned by its owner and
 * running on THAT owner's machine. It is addressed by HANDLE (`@quartz`) under
 * the one law: nothing acts unless addressed. The handle matches
 * `^[a-z][a-z0-9-]{1,30}$`, is unique per channel case-folded, and is
 * renameable by its owner alone.
 */
export interface ChannelAgent {
  id: string;
  channelId: string;
  workspaceId: string;
  /** The member who summoned it; the only one who may rename or park it. */
  ownerUserId: string;
  /** The handle as typed in an @-mention. */
  name: string;
  status: AgentStatus;
  /**
   * ENGAGEMENT — when a HUMAN last addressed this agent, or null while it is
   * IDLE. Idle = it sees everything in the room and acts only on messages that
   * tag it; engaged = it also acts on UNTAGGED messages from humans there.
   *
   * A FACT, not a state. The server records it and NEVER expires it: the client
   * (the desktop) compares it against its 60-minute engagement window and
   * refreshes engagement by ACTING. Read it through that window — a stamp older
   * than the window is still a stamp, never a boolean.
   *
   * Never set by an agent-authored message; that is the loop brake, server-side
   * and absolute.
   */
  engagedAt: string | null;
  /** The human who engaged it — audit, and the one non-owner who may disengage. */
  engagedBy: string | null;
  createdAt: string;
  updatedAt: string;
}

/** A thread participant is either a human member or a summoned agent. */
export type ParticipantKind = "user" | "agent";

/**
 * One identity in a thread's participant set — the breakout room's membership.
 * Exactly one of `userId` / `agentId` is set, matching `kind` (a DB CHECK
 * enforces the pairing in both directions).
 */
export interface ThreadParticipant {
  id: string;
  threadId: string;
  workspaceId: string;
  kind: ParticipantKind;
  /** Set iff `kind === "user"`. */
  userId: string | null;
  /** Set iff `kind === "agent"`. */
  agentId: string | null;
  addedBy: string | null;
  createdAt: string;
}

/**
 * How a participant is NAMED on the wire: `kind` plus the id of that identity
 * (a user id for `user`, an agent id for `agent`). One `id` field rather than
 * two nullable ones because the row itself is discriminated — a two-field body
 * could say otherwise.
 */
export interface ThreadParticipantRef {
  kind: ParticipantKind;
  id: string;
}

/**
 * A thread as the READ paths return it: the row plus its participant set.
 *
 * The set is `[]` for every thread that has none — a legacy (pair-gated)
 * thread is not a thread with a MISSING set, it is a thread whose set is
 * empty. Kept as its own type rather than an optional field on
 * {@link ChannelThread} because the WRITE paths (create / close / set mode)
 * return the row alone, and an optional `participants` would make every
 * consumer ask whether `undefined` meant "none" or "not loaded".
 */
export interface ChannelThreadDetail extends ChannelThread {
  participants: ThreadParticipant[];
}

/** `POST /agents` — summon one. Omit `name` to take the next pooled handle. */
export interface ChannelAgentCreateInput {
  /**
   * An explicit handle. Normally ABSENT: the server picks the next free handle
   * from its curated pool, which is what keeps a room's names collision-free.
   * A handle already taken in the channel is a 409 rather than a silent
   * alternative — a caller that asked for `quartz` and got `onyx` would go on
   * to address the wrong agent.
   */
  name?: string;
}

/**
 * `PATCH /agents/[agentId]` — rename it, move it along its lifecycle, or
 * DISENGAGE it. A discriminated union so the ops cannot bleed fields into each
 * other. The server enforces authorization (403), not this type, and it is NOT
 * uniform: `rename` / `set_status` are OWNER-ONLY, while `disengage` is the
 * owner OR the human recorded as having engaged it. `disengage` carries no
 * payload and is idempotent — an already-idle agent is not an error.
 *
 * Parking or dismissing an agent also clears its engagement server-side.
 */
export type ChannelAgentUpdateInput =
  | { op: "rename"; name: string }
  | { op: "set_status"; status: AgentStatus }
  | { op: "disengage" };

/**
 * What `createChannelThread` returns: the thread plus `openingSeq`, the seq of
 * the message the server posted as that thread's opening request.
 *
 * WHY (WAKE-V1): `openingSeq` is exactly the cursor the requester arms its
 * `await` on. Without it the caller had to follow up with `read limit=1` to
 * guess that seq — an extra round-trip, and a race whenever the peer answers in
 * between (the "newest message" would then be the reply, so the await would
 * start one past it and never see what already arrived).
 *
 * `null` when the route produced no opening message — only the idempotent
 * short-circuit that returns a thread created by SOMEONE ELSE.
 */
export interface ChannelThreadCreated {
  thread: ChannelThread;
  openingSeq: number | null;
}

/**
 * What `closeChannelThread` returns: the closed thread plus `echoSeq`, the seq
 * of the `task_finished` / `task_failed` marker the close posted.
 *
 * WHY: closing writes a message, so it moves the channel's cursor. A requester
 * that closes and then arms `await` has to know where the transcript now ends;
 * guessing it (last known seq + 1) once landed the cursor PAST a peer's reply
 * that was already in the channel, and the hold waited forever for a message it
 * had skipped. This is `openingSeq`'s mirror at the other end of a thread.
 *
 * `null` when the server reported no echo — either an older deployment that
 * does not send the field, or a close whose marker post failed. Both mean the
 * same thing to a caller: do NOT derive a cursor from it, look it up.
 */
export interface ChannelThreadClosed {
  thread: ChannelThread;
  echoSeq: number | null;
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
  /**
   * MULTIPLAYER — WHO THE MESSAGE IS FOR, when that is an AGENT: an agent id
   * or its handle (`@quartz` minus the `@`), resolved case-folded against THIS
   * channel's agents. Stamped by the server as `metadata.to_agent_id`; an
   * agent of another channel is a 400 about the address, never a silent stamp.
   * Addressing an agent is what makes it ACT.
   */
  toAgent?: string;
  /**
   * MULTIPLAYER — the SAME thing for N agents ("@quartz @onyx work together"):
   * agent ids and/or handles, max 8, deduped server-side. `toAgent` is exactly a
   * one-element `toAgents` and the two merge. Stamped as
   * `metadata.to_agent_ids`, with `metadata.to_agent_id` kept as a compat
   * mirror of the FIRST entry for clients that only read the scalar.
   *
   * ALL OR NOTHING: a ref that names no agent of this channel, or one whose
   * owner has left it, fails the whole post naming that ref — never a partial
   * address, which would leave the caller believing N machines are working when
   * fewer are.
   */
  toAgents?: string[];
  /**
   * MULTIPLAYER — WHO THE MESSAGE IS FROM, when that is one of the CALLER'S
   * OWN agents: the agent id (`metadata.author_agent_id`). It SUPPLEMENTS the
   * author, it never replaces one — `author_user_id` stays the calling human
   * on every path. Identity is server-verified: an agent belonging to someone
   * else is a 403, not a silent drop.
   */
  authorAgentId?: string;
  /**
   * CHAT vs. REQUEST — whether this post is allowed to reach anybody's agent.
   * Optional, and absent means `request`: today's behaviour, unchanged.
   *
   *  - `request` — the DM auto-address still fires (a post into a direct
   *    channel with no `to` is addressed to the peer server-side), so the
   *    receiving listener triggers. This is what makes a reply deliverable.
   *  - `chat` — HUMAN TALK. The DM auto-address is SKIPPED ENTIRELY: no
   *    `to_user_id` is manufactured, so nothing on the far side reads it as an
   *    ask. Everything else is a normal message — seq, realtime, read
   *    watermark, and an explicit `thread` tag if you pass one.
   *
   * `chat` together with `toUserId` / `toAgent` / `toAgents` is a
   * CONTRADICTION and is refused 400 `CHANNEL_CHAT_ADDRESSED`, never silently
   * resolved one way or the other.
   */
  intent?: MessageIntent;
}

/**
 * Whether a post is meant to reach an agent (`request`, the default) or to
 * reach only the humans in the room (`chat`). See `ChannelMessageInput.intent`.
 */
export type MessageIntent = "chat" | "request";

export interface ReadMessagesOptions {
  /** Return only messages with seq greater than this. */
  since?: number;
  /** Max messages to return (server caps at 200). */
  limit?: number;
  /**
   * Scope the read to ONE thread: only messages tagged with this thread id
   * (`metadata.taskId`) come back. Reconstructing an exchange otherwise means
   * paging the whole channel and filtering locally — five paged reads to
   * isolate fourteen messages, or one `limit=200` read that overruns the
   * caller's own output budget.
   *
   * A FILTER, not a lookup: a thread id nothing carries returns `[]` rather
   * than 404, and legacy `task-<channelId>-<seq>` ids work as well as uuids.
   * Composes with `since` / `limit` (same cursor and cap, fewer rows).
   */
  thread?: string;
}

export interface AwaitMessagesOptions {
  /** The last seq the caller has processed — poll for seq greater than it. */
  since: number;
  /** How long the server long-polls before returning `timedOut` (ms). */
  timeoutMs?: number;
  /**
   * Opt-in author exclusion: messages authored by this user id neither end
   * the poll nor appear in its result. A caller that posts while its own
   * await is armed otherwise wakes itself on its own echo. Leave unset to
   * watch every author (what a listener that also tracks its own account
   * needs).
   */
  excludeAuthor?: string;
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

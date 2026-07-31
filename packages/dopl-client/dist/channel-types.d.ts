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
export type ChannelMessageKind = "message" | "task_started" | "task_progress" | "task_finished" | "task_failed" | "system";
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
}
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
}
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

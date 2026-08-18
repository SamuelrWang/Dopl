/**
 * Channels v2 — the PURE derivations behind the three columns.
 *
 * Everything here is a function of what the existing read hooks already return
 * (`use-channels`, `use-channel-messages`, `use-channel-members`,
 * `use-channel-threads`). No fetching, no React, no formatting decisions that
 * belong to a component — which is what lets the sidebar's nesting, the
 * transcript's sides and the thread list's window be asserted without mounting
 * a tree.
 *
 * ⚠ `authorKind` is a DISPLAY CLAIM scoped to one user (INVARIANTS §5), never
 * an authentication fact. {@link toMessageRow} turns it into a chip and nothing
 * else: it never decides which SIDE a row hangs on. Side is
 * `authorUserId === currentUserId`, which is server-stamped from `ctx.userId`
 * and is the only authorship signal a caller cannot assert.
 */

import { PRESENCE_ONLINE_WINDOW_MS, SIDEBAR_THREAD_ACTIVE_WINDOW_MS } from "../../constants";
import type {
  Channel,
  ChannelMember,
  ChannelMessage,
  ChannelThread,
} from "../../types";
import type { AvatarPerson } from "@/shared/ui/avatar";

/**
 * The thread a message belongs to, or null for a channel-level post.
 *
 * ⚠ Deliberately a LOCAL three-line reader rather than an import from
 * `lib/group-thread.ts`: that module is the session-card machinery the wiring
 * plan retires in Phase 4, and a new surface must not take a dependency on
 * something scheduled for deletion. The `metadata.taskId` key itself is the
 * storage-boundary name (INVARIANTS §5) and is not going anywhere.
 */
export function threadIdOf(message: ChannelMessage): string | null {
  const value = message.metadata.taskId;
  return typeof value === "string" && value.length > 0 ? value : null;
}

/**
 * Lifecycle echoes render as NOTHING in this transcript.
 *
 * `task_started` / `task_finished` / `task_failed` state a fact about a RUNTIME,
 * and under the v2 model an agent's run state lives in the agent view, not as
 * transcript rows (MAPPING.md § Q&A rulings). Installed desktops keep posting
 * them long after the surface that read them is gone (wiring plan, Risk 4), so
 * the reader drops them rather than waiting on a server-side tightening that
 * cannot happen until the desktop floor is raised (INVARIANTS §13).
 */
function isLifecycleEcho(message: ChannelMessage): boolean {
  return (
    message.kind === "task_started" ||
    message.kind === "task_finished" ||
    message.kind === "task_failed"
  );
}

/** Which side of the transcript a row hangs on. An agent hangs on its
 *  operator's side — never in a third column (MAPPING.md § Message alignment). */
export type MessageSide = "peer" | "me";

export interface MessageRow {
  kind: "message";
  id: string;
  seq: number;
  side: MessageSide;
  /** Display claim only: renders the "Agent" chip beside the author name. */
  agent: boolean;
  author: AvatarPerson;
  authorLabel: string;
  /** Absolute wall-clock, so a row's time does not drift while it is read. */
  time: string;
  body: string;
  /** A run under the same author: no avatar gutter, no name line. */
  continuation: boolean;
}

/** A `system` row (joins, topic changes) — no side, no avatar, no author. */
export interface SystemRow {
  kind: "system";
  id: string;
  seq: number;
  body: string;
}

/**
 * A thread's OPENING message, rendered in the channel transcript as the card
 * the thread hangs off. The rest of the thread's messages are NOT in the
 * channel view — they belong to the thread's own transcript.
 */
export interface ThreadCardRow {
  kind: "thread-card";
  id: string;
  seq: number;
  side: MessageSide;
  author: AvatarPerson;
  authorLabel: string;
  time: string;
  thread: ChannelThread;
  /** The opening message's body — the card's preview line. */
  preview: string;
}

export type TranscriptRow = MessageRow | SystemRow | ThreadCardRow;

/** The people-lookup the rows are built against. */
export interface AuthorIndex {
  currentUserId: string;
  byId: ReadonlyMap<string, ChannelMember>;
}

export function indexMembers(
  members: ChannelMember[],
  currentUserId: string
): AuthorIndex {
  return { currentUserId, byId: new Map(members.map((m) => [m.userId, m])) };
}

/** An `AvatarPerson` for a message author, from the roster when it is there and
 *  from the message's own hydrated display fields when it is not (a departed
 *  member still owns their history). */
function personFor(
  message: ChannelMessage,
  index: AuthorIndex
): AvatarPerson {
  const member = message.authorUserId
    ? index.byId.get(message.authorUserId)
    : undefined;
  return {
    userId: message.authorUserId ?? `unknown-${message.id}`,
    email: member?.email ?? null,
    displayName: member?.displayName ?? message.authorName,
    avatarUrl: member?.avatarUrl ?? message.authorAvatarUrl,
  };
}

/** "You" for the viewer, else the roster name, else whatever the row carried. */
function labelFor(message: ChannelMessage, index: AuthorIndex): string {
  if (message.authorUserId === index.currentUserId) return "You";
  const member = message.authorUserId
    ? index.byId.get(message.authorUserId)
    : undefined;
  return (
    member?.displayName ?? member?.email ?? message.authorName ?? "Member"
  );
}

/** Same author and same agent-claim as the row above → a continuation run. */
function isContinuation(
  message: ChannelMessage,
  previous: ChannelMessage | null
): boolean {
  if (!previous) return false;
  if (previous.kind === "system") return false;
  return (
    previous.authorUserId === message.authorUserId &&
    previous.authorKind === message.authorKind
  );
}

function toMessageRow(
  message: ChannelMessage,
  previous: ChannelMessage | null,
  index: AuthorIndex,
  formatTime: (iso: string) => string
): MessageRow | SystemRow {
  if (message.kind === "system") {
    return { kind: "system", id: message.id, seq: message.seq, body: message.body };
  }
  return {
    kind: "message",
    id: message.id,
    seq: message.seq,
    side: message.authorUserId === index.currentUserId ? "me" : "peer",
    // DISPLAY CLAIM (INVARIANTS §5). The chip says "an agent typed this"; the
    // SIDE above still comes from the server-stamped author id.
    agent: message.authorKind === "agent",
    author: personFor(message, index),
    authorLabel: labelFor(message, index),
    time: formatTime(message.createdAt),
    body: message.body,
    continuation: isContinuation(message, previous),
  };
}

/**
 * THE CHANNEL VIEW's rows: every channel-level post, plus ONE card per thread
 * sitting where that thread's first message landed.
 *
 * A thread's remaining messages are deliberately absent — they are the thread
 * view's transcript, and repeating them here would make the channel the union
 * of every exchange it holds, which is the shape v2 exists to end. A message
 * tagged for a thread this read does not know (a clipped list, a legacy id)
 * falls back to rendering as an ordinary message rather than vanishing.
 */
export function channelRows(
  messages: ChannelMessage[],
  threads: ChannelThread[],
  index: AuthorIndex,
  formatTime: (iso: string) => string
): TranscriptRow[] {
  const threadById = new Map(threads.map((t) => [t.id, t]));
  const openerSeen = new Set<string>();
  const rows: TranscriptRow[] = [];
  let previous: ChannelMessage | null = null;

  for (const message of messages) {
    if (isLifecycleEcho(message)) continue;
    const threadId = threadIdOf(message);
    const thread = threadId ? threadById.get(threadId) : undefined;
    if (thread) {
      if (openerSeen.has(thread.id)) continue;
      openerSeen.add(thread.id);
      rows.push({
        kind: "thread-card",
        id: message.id,
        seq: message.seq,
        side: message.authorUserId === index.currentUserId ? "me" : "peer",
        author: personFor(message, index),
        authorLabel: labelFor(message, index),
        time: formatTime(message.createdAt),
        thread,
        preview: message.body,
      });
      previous = null;
      continue;
    }
    rows.push(toMessageRow(message, previous, index, formatTime));
    previous = message;
  }
  return rows;
}

/** THE THREAD VIEW's rows: only the messages tagged for that thread. */
export function threadRows(
  messages: ChannelMessage[],
  threadId: string,
  index: AuthorIndex,
  formatTime: (iso: string) => string
): TranscriptRow[] {
  const rows: TranscriptRow[] = [];
  let previous: ChannelMessage | null = null;
  for (const message of messages) {
    if (isLifecycleEcho(message)) continue;
    if (threadIdOf(message) !== threadId) continue;
    rows.push(toMessageRow(message, previous, index, formatTime));
    previous = message;
  }
  return rows;
}

/**
 * The threads the SIDEBAR TREE shows: active inside
 * {@link SIDEBAR_THREAD_ACTIVE_WINDOW_MS} (Samuel, 2026-08-18).
 *
 * ⚠ CLIENT-SIDE arithmetic over `lastActivityAt`, exactly as presence is over
 * `lastSeenAt` (INVARIANTS §5) — the repository read is one plain bounded,
 * activity-ordered list and knows nothing about this window. ABSENT
 * `lastActivityAt` means the read did not derive it, never "no activity", so it
 * reads INACTIVE here: the same fail-safe direction presence has.
 *
 * ⚠ The ruling is "active in the last 24 hours **OR REQUESTED**". `requested`
 * has no server-side existence yet — it is a thread whose consent rows are
 * still pending, and nothing projects that (wiring plan, Phase 3+). Until it
 * does, this window IS the whole rule; the requested arm is not silently
 * approximated with something else.
 *
 * ⚠ ORDER IS PRESERVED, never re-sorted: the server clipped its page against
 * the activity order, so a re-sorted page is the wrong rows in a plausible
 * order (INVARIANTS §5).
 */
export function sidebarThreads(
  threads: ChannelThread[],
  now: number = Date.now()
): ChannelThread[] {
  return threads.filter((thread) => {
    if (!thread.lastActivityAt) return false;
    const ts = new Date(thread.lastActivityAt).getTime();
    if (Number.isNaN(ts)) return false;
    return now - ts < SIDEBAR_THREAD_ACTIVE_WINDOW_MS;
  });
}

/**
 * Presence, computed HERE rather than read off the DTO's `agentOnline`.
 *
 * `agentOnline` is the server's verdict at READ time and goes stale between
 * refetches; the 90s window over `lastSeenAt` is arithmetic the client can redo
 * on every render (INVARIANTS §7, and the same shape `pages/channels/index.tsx`
 * documents). Fails safe in one direction only: a stale roster reads OFFLINE.
 */
export function isPresent(
  member: Pick<ChannelMember, "lastSeenAt">,
  now: number = Date.now()
): boolean {
  if (!member.lastSeenAt) return false;
  const ts = new Date(member.lastSeenAt).getTime();
  if (Number.isNaN(ts)) return false;
  return now - ts < PRESENCE_ONLINE_WINDOW_MS;
}

/** An `AvatarPerson` for a roster row. */
export function memberPerson(member: ChannelMember): AvatarPerson {
  return {
    userId: member.userId,
    email: member.email,
    displayName: member.displayName,
    avatarUrl: member.avatarUrl,
  };
}

/** The two parties of a thread (INVARIANTS §5: one requester + one target),
 *  resolved through the roster; unknown ids are dropped rather than faked. */
export function threadParties(
  thread: ChannelThread,
  index: AuthorIndex
): AvatarPerson[] {
  const ids = [thread.createdBy, thread.targetUserId].filter(
    (id): id is string => typeof id === "string" && id.length > 0
  );
  return [...new Set(ids)]
    .map((id) => index.byId.get(id))
    .filter((m): m is ChannelMember => m !== undefined)
    .map(memberPerson);
}

/** "Diana Taylor" → "Diana T."; the viewer is always "you". */
export function shortName(person: AvatarPerson, currentUserId: string): string {
  if (person.userId === currentUserId) return "you";
  const [first, last] = (person.displayName ?? person.email ?? "").split(" ");
  return last ? `${first} ${last.charAt(0)}.` : (first ?? "Member");
}

/** Direct channels are the DM section; everything else is the channel tree. */
export function splitChannels(channels: Channel[]): {
  direct: Channel[];
  rooms: Channel[];
} {
  return {
    direct: channels.filter((c) => c.isDirect),
    rooms: channels.filter((c) => !c.isDirect),
  };
}

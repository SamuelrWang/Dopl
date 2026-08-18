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

import { PRESENCE_ONLINE_WINDOW_MS } from "../../constants";
import { mentionedUserIdsOf } from "../../lib/mentions";
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
 * The REQUEST FAN-OUT group a thread's opening message belongs to, or null.
 *
 * ⚠ Reserved, server-stamped metadata (`server/service-writes-metadata.ts ›
 * resolvePostMetadata`), stripped from caller input like every other reserved
 * key — which is what makes it safe to render N threads as ONE card. A
 * caller-settable group id would let a member draw their own thread inside
 * somebody else's request.
 *
 * ⚠ Absent on every thread opened before the fan-out shipped, and on every
 * single-target `create_thread` (the desktop and MCP lane still post those).
 * Absent means "a group of one", never "unknown" — one thread, one card.
 */
export function fanoutGroupOf(message: ChannelMessage): string | null {
  const value = message.metadata.fanoutGroup;
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
  /**
   * This message's SERVER-STAMPED mention set names the viewer.
   *
   * ⚠ THE ONE SOURCE for "am I tagged here", shared with the Tags inbox — the
   * transcript's self-tint reads THIS, never a fresh parse of the body against
   * the current roster. A re-derivation would drift from the stamp the moment
   * a display name changed, and the row would then be tinted in the transcript
   * and absent from the inbox (or the reverse).
   */
  mentionsMe: boolean;
}

/** A `system` row (joins, topic changes) — no side, no avatar, no author. */
export interface SystemRow {
  kind: "system";
  id: string;
  seq: number;
  body: string;
}

/**
 * A REQUEST, rendered in the channel transcript as the card its threads hang
 * off. The threads' remaining messages are NOT in the channel view — they
 * belong to each thread's own transcript.
 *
 * ⚠ ONE CARD, N THREADS. A three-pill send is three `channel_tasks` rows
 * (INVARIANTS §5 — a thread is one requester + one target) sharing one
 * server-stamped `fanoutGroup`, and this row is the group. `threads` is in
 * opening-message order, which is addressee order.
 */
export interface ThreadCardRow {
  kind: "thread-card";
  id: string;
  seq: number;
  side: MessageSide;
  author: AvatarPerson;
  authorLabel: string;
  time: string;
  /** Every thread of the request, in addressee order. Never empty. */
  threads: ChannelThread[];
  /** Which thread "Open thread" opens — see {@link ownThreadOf}. */
  openThreadId: string;
  /** The opening message's body — the card's preview line. */
  preview: string;
}

/**
 * Which of a request's threads THIS viewer walks into.
 *
 * ⚠ A thread is readable by every channel member but WRITABLE only by its two
 * parties (INVARIANTS §5), so the viewer's own thread is the one they can
 * answer in. Falling back to the first keeps a bystander's "Open thread"
 * working — they can read it, which is what the fallback promises and all it
 * promises.
 */
export function ownThreadOf(
  threads: ChannelThread[],
  currentUserId: string
): ChannelThread {
  return (
    threads.find(
      (t) => t.createdBy === currentUserId || t.targetUserId === currentUserId
    ) ?? threads[0]
  );
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
    // RESERVED, SERVER-STAMPED metadata (`server/service-writes-metadata.ts ›
    // resolvePostMetadata`, fold 9), stripped from caller input like every
    // other reserved key — which is what makes it safe to render as "you were
    // tagged". Absent on every row written before Phase 6, and absent means
    // TAGS NOBODY, never unknown.
    mentionsMe: mentionedUserIdsOf(message.metadata).includes(
      index.currentUserId
    ),
  };
}

/**
 * Every thread of one fan-out group, keyed by that group id, in
 * opening-message order.
 *
 * ⚠ A PRE-PASS, not a scan-as-you-go. The card is drawn at the FIRST opener of
 * a group and must already name all N addressees, so the group has to be known
 * before that row is emitted. It is derived from the messages rather than the
 * thread list because only the messages carry the group id — `channel_tasks`
 * has no such column, deliberately (nothing indexes on it).
 */
function groupThreads(
  messages: ChannelMessage[],
  threadById: ReadonlyMap<string, ChannelThread>
): Map<string, ChannelThread[]> {
  const groups = new Map<string, ChannelThread[]>();
  for (const message of messages) {
    const group = fanoutGroupOf(message);
    const threadId = group ? threadIdOf(message) : null;
    const thread = threadId ? threadById.get(threadId) : undefined;
    if (!group || !thread) continue;
    const members = groups.get(group) ?? [];
    if (!members.some((t) => t.id === thread.id)) members.push(thread);
    groups.set(group, members);
  }
  return groups;
}

/**
 * THE CHANNEL VIEW's rows: every channel-level post, plus ONE card per REQUEST
 * sitting where that request's first opening message landed.
 *
 * A thread's remaining messages are deliberately absent — they are the thread
 * view's transcript, and repeating them here would make the channel the union
 * of every exchange it holds, which is the shape v2 exists to end. A message
 * tagged for a thread this read does not know (a clipped list, a legacy id)
 * falls back to rendering as an ordinary message rather than vanishing.
 *
 * ⚠ A FAN-OUT COLLAPSES. Its N opening messages share one server-stamped
 * `fanoutGroup`, and only the first emits a card; the rest are skipped, exactly
 * as a thread's later messages are. Without the collapse a three-pill request
 * would read as three identical posts.
 */
export function channelRows(
  messages: ChannelMessage[],
  threads: ChannelThread[],
  index: AuthorIndex,
  formatTime: (iso: string) => string
): TranscriptRow[] {
  const threadById = new Map(threads.map((t) => [t.id, t]));
  const groups = groupThreads(messages, threadById);
  const openerSeen = new Set<string>();
  const rows: TranscriptRow[] = [];
  let previous: ChannelMessage | null = null;

  for (const message of messages) {
    if (isLifecycleEcho(message)) continue;
    const threadId = threadIdOf(message);
    const thread = threadId ? threadById.get(threadId) : undefined;
    if (thread) {
      const group = fanoutGroupOf(message);
      // ⚠ The dedupe key is the GROUP where there is one, the thread otherwise.
      // Keying on the thread alone would draw N cards for one request.
      const key = group ?? thread.id;
      if (openerSeen.has(key)) continue;
      openerSeen.add(key);
      const cardThreads = (group && groups.get(group)) || [thread];
      rows.push({
        kind: "thread-card",
        id: message.id,
        seq: message.seq,
        side: message.authorUserId === index.currentUserId ? "me" : "peer",
        author: personFor(message, index),
        authorLabel: labelFor(message, index),
        time: formatTime(message.createdAt),
        threads: cardThreads,
        openThreadId: ownThreadOf(cardThreads, index.currentUserId).id,
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

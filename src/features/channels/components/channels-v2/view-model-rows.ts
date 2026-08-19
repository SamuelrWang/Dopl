/**
 * Channels v2 — THE TRANSCRIPT'S ROWS: the union a pane renders, and the
 * derivations that build it out of one channel's messages.
 *
 * Its own file because it has its own reason to change: `view-model.ts` holds
 * the BASE readers every channels-v2 surface shares (the metadata readers, the
 * roster index, presence, display names, the channel split), and this turns a
 * message LIST into the ordered rows one pane draws — message runs, fan-out
 * cards, lifecycle receipts. Same split rule, and the same precedent, as
 * `view-model-requested.ts` (INVARIANTS §1: one file per reason to change).
 *
 * ⚠ `authorKind` is a DISPLAY CLAIM scoped to one user (INVARIANTS §5), never
 * an authentication fact. {@link toMessageRow} turns it into a chip and nothing
 * else: it never decides which SIDE a row hangs on. Side is
 * `authorUserId === currentUserId`, which is server-stamped from `ctx.userId`
 * and is the only authorship signal a caller cannot assert.
 */

import { mentionedUserIdsOf } from "../../lib/mentions";
import {
  RECEIPT_LABEL,
  lifecycleReceiptStatus,
  type ReceiptStatus,
} from "../../lib/message-receipt";
import { fanoutGroupOf, threadIdOf, type AuthorIndex } from "./view-model";
import type { ChannelMessage, ChannelThread } from "../../types";
import type { AvatarPerson } from "@/shared/ui/avatar";

/**
 * The three RUNTIME-STATE kinds. Never a message bubble on any surface — the
 * most a lifecycle row can be is a receipt, and `task_started` cannot even be
 * that. ⚠ `task_progress` is deliberately absent: the calm `session_ended` note
 * is the milestone lane and its BODY is real prose a peer needs (INVARIANTS §5).
 */
function isLifecycleKind(message: ChannelMessage): boolean {
  return (
    message.kind === "task_started" ||
    message.kind === "task_finished" ||
    message.kind === "task_failed"
  );
}

/**
 * A terminal lifecycle row's RECEIPT ROW, or null when it renders as nothing.
 *
 * ⚠ **THIS USED TO DROP ALL THREE KINDS, AND THAT SILENCED THIS BUILD'S OWN
 * CONSENT OUTCOMES.** `main/trigger-outcomes.js` posts `task_failed` +
 * `{declined:true}` / `{dropped:true}` / `{interrupted:true}` on the SHIPPING
 * desktop and the headless lane posts the full set, so a peer who DECLINED left
 * the requester looking at an unanswered ask. A calm ending changes how the peer
 * reads the exchange — INVARIANTS §5's calm-flag rationale is the whole argument
 * for storing the flag — so it renders.
 *
 * Still nothing, and the line is drawn at the KIND: **`task_started` always**
 * (run state lives in the Agents tab — INVARIANTS §5; the ruling arrived in the
 * port's intent doc, deleted at the Phase 12 cutover), and a terminal row with
 * no calm flag AND no body (a bare state transition, nothing human in it). The
 * derivation is `lib/message-receipt.ts › lifecycleReceiptStatus` — the receipt
 * VOCABULARY the retired page spoke, so "Declined" has one spelling, not two.
 */
function toReceiptRow(
  message: ChannelMessage,
  formatTime: (iso: string) => string
): ReceiptRow | null {
  const status = lifecycleReceiptStatus(message);
  if (status === null) return null;
  return {
    kind: "receipt",
    id: message.id,
    seq: message.seq,
    status,
    label: RECEIPT_LABEL[status],
    // ⚠ `failed` is the ONE lifecycle status that is not an operator-chosen
    // ending, so it is the only one that may wear alarm ink — the distinction
    // `lib/calm-terminal.ts` exists to preserve.
    calm: status !== "failed",
    time: formatTime(message.createdAt),
  };
}

/** Which side of the transcript a row hangs on. An agent hangs on its
 *  operator's side — never in a third column (INVARIANTS §5). */
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
 * A RECEIPT: how one exchange ENDED, on a slim muted line of its own. No side,
 * no avatar, no author, because it is not somebody's words — the same shape as
 * {@link SystemRow} on purpose: both are the transcript narrating itself.
 *
 * ⚠ The desktop's own body copy is NOT carried here. `label` comes from the
 * FLAG via `lib/message-receipt.ts › RECEIPT_LABEL`, so a caller-influenceable
 * sentence can never state the outcome (INVARIANTS §5).
 */
export interface ReceiptRow {
  kind: "receipt";
  id: string;
  seq: number;
  status: ReceiptStatus;
  /** Flag-derived label — never the row's own body. */
  label: string;
  /** An operator-chosen ending; only a REAL `failed` is false. */
  calm: boolean;
  time: string;
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

export type TranscriptRow =
  | MessageRow
  | SystemRow
  | ThreadCardRow
  | ReceiptRow;

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
    const threadId = threadIdOf(message);
    const thread = threadId ? threadById.get(threadId) : undefined;
    if (isLifecycleKind(message)) {
      // ⚠ A receipt for a KNOWN thread belongs to THAT thread's transcript, by
      // the same rule the thread's other messages follow — the channel shows
      // the card, not the exchange. A legacy `task-<channel>-<seq>` tag names
      // no `channel_tasks` row, so the desktop trigger lane's outcomes land
      // here, beside the ask they answer, which is where they were asked.
      if (!thread) {
        const receipt = toReceiptRow(message, formatTime);
        if (receipt) rows.push(receipt);
      }
      continue;
    }
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
    if (threadIdOf(message) !== threadId) continue;
    if (isLifecycleKind(message)) {
      const receipt = toReceiptRow(message, formatTime);
      if (receipt) rows.push(receipt);
      // ⚠ `previous` is UNCHANGED across a receipt: it is not authored, so it
      // must neither break nor extend the run of messages around it.
      continue;
    }
    rows.push(toMessageRow(message, previous, index, formatTime));
    previous = message;
  }
  return rows;
}

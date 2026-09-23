/** Channels — the transcript's row union and its builders. `authorKind` is a display claim
 *  (INVARIANTS §5): the side is always the server-stamped `authorUserId === currentUserId`. */

import { mentionedUserIdsOf } from "../lib/mentions";
import { authorViewOf, desktopAddresseeOf } from "../lib/desktop-handle";
// The module the server's router reads, so the faced tag and the woken agent agree.
import { serverRoutedAgentIds } from "../lib/agent-post-stamp";
import { addressKey } from "../lib/recipient-tags";
import {
  isLifecycleKind,
  toReceiptRow,
  type ReceiptRow,
} from "./view-model-receipt-rows";
import { authorAgentIdOf } from "./agents-model";
import {
  fanoutGroupOf,
  labelFor,
  personFor,
  threadIdOf,
  type AuthorIndex,
} from "./view-model";
import {
  answersByEscalation,
  escalationRowFor,
  type EscalationRow,
} from "./view-model-escalation";
import type { ArtifactRow } from "./view-model-artifacts";
import type { ChannelMessage, ChannelThread } from "../types";
import type { AvatarPerson } from "@/shared/ui/avatar";

// Re-exported so this stays the one import path for transcript row types.
export type { ReceiptRow } from "./view-model-receipt-rows";

/** An agent hangs on its operator's side — never a third column (INVARIANTS §5). */
export type MessageSide = "peer" | "me";

export interface MessageRow {
  kind: "message";
  id: string;
  seq: number;
  side: MessageSide;
  /** Display claim only, off `authorKind`. */
  agent: boolean;
  /** An outside session wrote it — a narrowing of `agent` (both are true). */
  external: boolean;
  /** Addressed `to=@desktop` — about the recipient, independent of `external`. */
  routedDesktop: boolean;
  /** Which of the author's agents wrote it (`lib/agent-post-stamp.ts › authorAgentIdOf`);
   *  `null` is "cannot say", never "not an agent". Display claim only. */
  agentId: string | null;
  author: AvatarPerson;
  authorLabel: string;
  /** Absolute wall-clock, so a row's time does not drift while it is read. */
  time: string;
  body: string;
  /** A run under the same author: no avatar gutter, no name line. */
  continuation: boolean;
  /** The server-stamped mention set names the viewer — one source with the Tags inbox. */
  mentionsMe: boolean;
  /** Agents the server routed an untagged post to (`lib/agent-post-stamp.ts ›
   *  serverRoutedAgentIds`); ids only, named at render. */
  routedAgentIds: string[];
  /** The stamped `to=` agents (`lib/recipient-tags.ts`). Agent rows only; ids, named at render. */
  recipientAgentIds: string[];
  /** The people half of `recipientAgentIds` — same source and gate, never merged with it. */
  recipientUserIds: string[];
}

/** A `system` row (joins, topic changes) — no side, avatar or author. */
export interface SystemRow {
  kind: "system";
  id: string;
  seq: number;
  body: string;
}

/** A request's card in the channel view — one per fan-out (N `channel_tasks` rows sharing a
 *  server-stamped `fanoutGroup`); the threads' messages live in the thread view. */
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
  /** Which thread "Open thread" opens — {@link ownThreadOf}. */
  openThreadId: string;
  /** The opening message's body — the card's preview line. */
  preview: string;
}

/** The viewer's own thread (only its two parties can write — INVARIANTS §5), else the first. */
function ownThreadOf(
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
  | ReceiptRow
  | EscalationRow
  // Type-only: `view-model-artifacts.ts` never imports this file back, so no cycle.
  | ArtifactRow;

/** Same author and `authorKind` as the previous row → a continuation (no avatar, name, pill). */
function isContinuation(
  message: ChannelMessage,
  previous: ChannelMessage | null
): boolean {
  if (!previous) return false;
  if (previous.kind === "system") return false;
  if (
    previous.authorUserId !== message.authorUserId ||
    previous.authorKind !== message.authorKind
  ) {
    return false;
  }
  // Agent rows only: a human's caller-chosen `client_msg_id` must not split their run.
  if (message.authorKind !== "agent") return true;
  return (
    // A different agent instance or address breaks the run — a continuation has no pill.
    authorAgentIdOf(previous) === authorAgentIdOf(message) &&
    // `addressKey` keeps an absent recipient set distinct from an empty one.
    addressKey({
      agentIds: previous.recipientAgentIds,
      userIds: previous.recipientUserIds,
    }) ===
      addressKey({
        agentIds: message.recipientAgentIds,
        userIds: message.recipientUserIds,
      })
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
    agent: message.authorKind === "agent",
    // Both derived from server-stamped metadata (`lib/desktop-handle.ts`).
    external: authorViewOf(message) === "external",
    routedDesktop: desktopAddresseeOf(message) !== null,
    // Agent rows only: a human may pick a stamp-shaped `client_msg_id`. The fallback,
    // `metadata.session_id`, is server-stamped and stripped from caller input.
    agentId:
      message.authorKind === "agent" ? authorAgentIdOf(message) : null,
    author: personFor(message, index),
    authorLabel: labelFor(message, index),
    time: formatTime(message.createdAt),
    body: message.body,
    continuation: isContinuation(message, previous),
    // Reserved server-stamped metadata, stripped from caller input; absent means tags nobody.
    mentionsMe: mentionedUserIdsOf(message.metadata).includes(
      index.currentUserId
    ),
    // The stored verdict, never re-derived from the body (that would be a second router).
    routedAgentIds: serverRoutedAgentIds(message),
    // Agent rows only — a human's address is in their own words. `?? []` merges absent and
    // null; `isContinuation` reads the raw fields, where they stay distinct.
    recipientAgentIds:
      message.authorKind === "agent" ? [...(message.recipientAgentIds ?? [])] : [],
    recipientUserIds:
      message.authorKind === "agent" ? [...(message.recipientUserIds ?? [])] : [],
  };
}

/** Each fan-out group's threads in opening-message order — a pre-pass, since the card at the
 *  first opener must already name all N and only messages carry the group id. */
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

/** The channel view: channel-level posts plus one card per request at its first opener. A
 *  message tagged for a thread this read does not know renders as an ordinary message. */
export function channelRows(
  messages: ChannelMessage[],
  threads: ChannelThread[],
  index: AuthorIndex,
  formatTime: (iso: string) => string
): TranscriptRow[] {
  const threadById = new Map(threads.map((t) => [t.id, t]));
  const groups = groupThreads(messages, threadById);
  const answers = answersByEscalation(messages, index);
  const openerSeen = new Set<string>();
  const rows: TranscriptRow[] = [];
  let previous: ChannelMessage | null = null;

  for (const message of messages) {
    const threadId = threadIdOf(message);
    const thread = threadId ? threadById.get(threadId) : undefined;
    // Before the thread branch: an escalation stays in the channel view even when threaded.
    const escalationRow = escalationRowFor(message, index, answers, formatTime);
    if (escalationRow) {
      rows.push(escalationRow);
      // A card has no pill, so the run must not continue across it (F-251).
      previous = null;
      continue;
    }
    if (isLifecycleKind(message)) {
      // A known thread's receipt belongs to its thread view; a legacy `task-<channel>-<seq>`
      // tag names no thread, so it lands here.
      if (!thread) {
        const receipt = toReceiptRow(message, formatTime);
        if (receipt) rows.push(receipt);
      }
      continue;
    }
    if (thread) {
      const group = fanoutGroupOf(message);
      // Track group AND thread ids: only openers carry `fanoutGroup`, so replies match by thread.
      if (openerSeen.has(thread.id) || (group != null && openerSeen.has(group)))
        continue;
      const cardThreads = (group && groups.get(group)) || [thread];
      if (group != null) openerSeen.add(group);
      for (const member of cardThreads) openerSeen.add(member.id);
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

/** The thread view: only the messages tagged for that thread. */
export function threadRows(
  messages: ChannelMessage[],
  threadId: string,
  index: AuthorIndex,
  formatTime: (iso: string) => string
): TranscriptRow[] {
  const rows: TranscriptRow[] = [];
  const answers = answersByEscalation(messages, index);
  let previous: ChannelMessage | null = null;
  for (const message of messages) {
    if (threadIdOf(message) !== threadId) continue;
    const escalationRow = escalationRowFor(message, index, answers, formatTime);
    if (escalationRow) {
      rows.push(escalationRow);
      previous = null;
      continue;
    }
    if (isLifecycleKind(message)) {
      const receipt = toReceiptRow(message, formatTime);
      if (receipt) rows.push(receipt);
      // `previous` unchanged: a receipt neither breaks nor extends a run.
      continue;
    }
    rows.push(toMessageRow(message, previous, index, formatTime));
    previous = message;
  }
  return rows;
}

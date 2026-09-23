/**
 * Channels — THE TRANSCRIPT'S ROWS: the union a pane renders, and the
 * derivations that build it out of one channel's messages.
 *
 * Its own file because it has its own reason to change: `view-model.ts` holds
 * the BASE readers every channels surface shares (the metadata readers, the
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

import { mentionedUserIdsOf } from "../lib/mentions";
// ⚠ ONE projection, shared with the server and the MCP renderer — see
// `lib/desktop-handle.ts` for why this is not a DTO field.
import { authorViewOf, desktopAddresseeOf } from "../lib/desktop-handle";
// ⚠ THE `lib/` COPY, NOT A LOCAL ONE: the same module the SERVER's arm 3 reads,
// so the tag this transcript faces and the agent the router woke are one answer.
import { serverRoutedAgentIds } from "../lib/agent-post-stamp";
// ⚠ THE ADDRESS KEY ONLY — the FACES are resolved at render, never on a row
// (`lib/recipient-tags.ts`, and {@link MessageRow.recipientAgentIds}'s note).
import { addressKey } from "../lib/recipient-tags";
// ⚠ THE RECEIPT HALF IS ITS OWN MODULE (§1 split, 2026-09-22) — it moves when the
// LIFECYCLE vocabulary moves, this file when a MESSAGE row's shape does. Same seam, and
// the same argument, as `view-model-escalation.ts` below.
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
// ⚠ THE ESCALATION HALF IS ITS OWN MODULE (§1 split, 2026-08-31) — it moves when
// the escalation product moves, this file when a MESSAGE row's shape moves.
import {
  answersByEscalation,
  escalationRowFor,
  type EscalationRow,
} from "./view-model-escalation";
import type { ArtifactRow } from "./view-model-artifacts";
import type { ChannelMessage, ChannelThread } from "../types";
import type { AvatarPerson } from "@/shared/ui/avatar";

// ⚠ RE-EXPORTED WHOLE so `view-model-rows` stays the ONE import path for a transcript
// row's types — `transcript.tsx` imports {@link ReceiptRow} from here and did not move
// (the `types.ts › ChannelListProjection` precedent: a split, not a new import site).
export type { ReceiptRow } from "./view-model-receipt-rows";

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
  /** An OUTSIDE SESSION wrote it. ⚠ A NARROWING of {@link MessageRow.agent},
   *  never a sibling — both are true and the chip shows the specific word. */
  external: boolean;
  /** It was addressed `to=@desktop`. ⚠ A RECIPIENT, unrelated to `external`
   *  (which is about the AUTHOR); a row can be either, both or neither. */
  routedDesktop: boolean;
  /**
   * WHICH of the author's agents typed this, when the writer said so — the
   * stamped per-instance id off `client_msg_id`
   * (`agents-model.ts › parseAgentPostStamp`).
   *
   * ⚠ `null` IS "CANNOT SAY", AND IT IS THE COMMON CASE ON OLD ROWS. It never
   * means "not an agent" — {@link MessageRow.agent} answers that, off
   * `authorKind`, and the two are independent: an agent post with no stamp is
   * `agent: true, agentId: null` and wears the plain chip.
   *
   * ⚠ IT CHANGES NO SIDE AND NO IDENTITY. `client_msg_id` is a caller-supplied
   * idempotency key, so this is a DISPLAY claim exactly like `agent` is — the
   * row still hangs on the server-stamped `author_user_id`.
   */
  agentId: string | null;
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
  /**
   * THE AGENTS THE SERVER AIMED THIS ROW AT WHEN THE AUTHOR TYPED NO TAG —
   * `lib/agent-post-stamp.ts › serverRoutedAgentIds` (Samuel, 2026-09-05:
   * history must not read as addressed to nobody when it was not).
   *
   * ⚠ **IDS, NOT NAMES, AND THE ROW CARRIES NO FACE.** The same rule
   * {@link MessageRow.agentId} follows, for the same reason: a display name is
   * peer-set and renamed at will, so it is resolved AT RENDER off
   * `AuthorIndex.agents` and never frozen into a row (2026-08-27).
   *
   * ⚠ **EMPTY ON EVERY ORDINARY ROW**, including every row carrying a tag the
   * author TYPED — those already show their tag, in the body, where the author
   * put it. This is only the rows that would otherwise read as addressed to
   * nobody.
   */
  routedAgentIds: string[];
  /**
   * **WHO THE SERVER ACTUALLY DELIVERED THIS POST TO** — the stamped `to=` set,
   * faced beside the attribution pill (2026-09-22, decision #2200 option 1). Whole
   * ruling, and why an empty set draws nothing: `lib/recipient-tags.ts`.
   *
   * ⚠ **AGENT ROWS ONLY** — a person's composer writes the handle into their own
   * words, so a human row is always `[]` here (that gate is stated in
   * {@link toMessageRow}, once). ⚠ **IDS, NEVER FACES**, on
   * {@link MessageRow.routedAgentIds}'s rule and for its reason.
   */
  recipientAgentIds: string[];
  /** The PEOPLE half of {@link MessageRow.recipientAgentIds} — same source, same
   *  gate. A different namespace, never merged with the agents. */
  recipientUserIds: string[];
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
  // ⚠ TYPE-ONLY, AND THE ARROW IS ONE-WAY: `view-model-artifacts.ts` builds this
  // row and never imports this file back, so the union can widen without a cycle.
  | ArtifactRow;

/**
 * Same author, same agent-claim AND same agent INSTANCE as the row above → a
 * continuation run.
 *
 * ⚠ THE INSTANCE CONJUNCT IS THE HALF THAT MATTERS SINCE MULTIPLAYER (Samuel,
 * 2026-08-22). A continuation drops the avatar, the name line and the chip — so
 * two of one operator's agents alternating in a thread collapsed into a single
 * unbroken run under one name, which is the "it looks like one agent sending"
 * report exactly. The attribution pill cannot fix that on its own: on a
 * continuation there is no pill to put an id in. A different stamped agent
 * therefore BREAKS the run and earns its own header.
 *
 * ⚠ AN UNSTAMPED ROW STILL CONTINUES ONE. `null === null` for two legacy agent
 * posts, so a main that predates the stamp groups exactly as it always did;
 * `null` never MATCHES a real id, so a stamped post after an unstamped one gets
 * its header. Both directions fail toward showing the reader a name rather than
 * hiding one.
 */
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
  // ⚠ AGENT ROWS ONLY, the same guard the `agentId` field carries: a HUMAN's
  // `client_msg_id` is whatever their client chose, and a caller who happened to
  // pick the stamp shape must not be able to split their own run.
  if (message.authorKind !== "agent") return true;
  return (
    // ⚠ THE SESSION KEY COUNTS TOO (2026-09-04). Keyed on the STAMP alone, every post an agent
    // gave its own `client_msg_id` answered `null` — so two of an operator's agents alternating
    // read as one continuous speaker, which is the exact collapse this predicate exists to stop.
    authorAgentIdOf(previous) === authorAgentIdOf(message) &&
    // ⚠ **AND THE ADDRESS COUNTS TOO, SINCE 2026-09-22** (decision #2200). The tag hangs
    // off the pill and a continuation has no pill, so one agent posting to three places
    // would collapse under ONE tag naming the first of them — the disagreement the tag
    // exists to remove, rebuilt by the layout. A new address earns a new header, and
    // `addressKey` reads an ABSENT set as its own value so legacy runs group unchanged.
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
    // DISPLAY CLAIM (INVARIANTS §5). The chip says "an agent typed this"; the
    // SIDE above still comes from the server-stamped author id.
    agent: message.authorKind === "agent",
    // OUTSIDE SESSION (2026-09-18). ⚠ Both DERIVED from server-stamped metadata,
    // so no DTO field and no fixture moves. `lib/desktop-handle.ts`.
    external: authorViewOf(message) === "external",
    routedDesktop: desktopAddresseeOf(message) !== null,
    // ⚠ ONLY ON AN AGENT ROW. A human post can carry any `client_msg_id` the
    // client chose, including one shaped like the stamp, and reading it here
    // unconditionally would let a caller hang an agent id off their own words.
    // ⚠ THE SERVER'S `metadata.session_id` IS THE SECOND DOOR AND THE SAFER ONE (2026-09-04).
    // `client_msg_id` is caller-chosen and the desktop never overwrites one an agent supplied,
    // so keying on the stamp alone printed the bare noun "Agent" over every post a named session
    // wrote with its own idempotency key (`attribution-pill.tsx › attributionName`'s last
    // branch) — a rename the operator had made and could not see. `session_id` is stripped from
    // caller input and re-stamped server-side, so it cannot be posed either.
    agentId:
      message.authorKind === "agent" ? authorAgentIdOf(message) : null,
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
    // ⚠ THE STORED VERDICT, FACED — never a re-derivation. The server already
    // decided who an untagged post reached and stamped both halves of the
    // evidence on the row; asking the transcript to work it out again from the
    // body would be a second router, and the two would disagree the first time
    // the rule changed. `serverRoutedAgentIds` is the complement of the
    // predicate RR3's own arm 3 turns on, spelled once, in `lib/`.
    routedAgentIds: serverRoutedAgentIds(message),
    // ⚠ **THE STAMPED ADDRESS, ONLY ON AN AGENT ROW** (2026-09-22, decision #2200). The
    // gate is HERE, once: a human's row keeps its address in the WORDS their composer
    // wrote, and two places deciding that is how one of them drifts.
    // ⚠ NOT `serverRoutedAgentIds` — that is the narrow "routed although nobody was
    // tagged" subset; this is every recipient the post reached.
    // ⚠ `?? []` COLLAPSES ABSENT AND NULL, which the TAG wants and the GROUPING does not —
    // `isContinuation` above reads the message's own fields, where the three stay apart.
    recipientAgentIds:
      message.authorKind === "agent" ? [...(message.recipientAgentIds ?? [])] : [],
    recipientUserIds:
      message.authorKind === "agent" ? [...(message.recipientUserIds ?? [])] : [],
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
  const answers = answersByEscalation(messages, index);
  const openerSeen = new Set<string>();
  const rows: TranscriptRow[] = [];
  let previous: ChannelMessage | null = null;

  for (const message of messages) {
    const threadId = threadIdOf(message);
    const thread = threadId ? threadById.get(threadId) : undefined;
    // ⚠ AN ESCALATION IS CHECKED BEFORE THE THREAD BRANCH AND STAYS IN THE
    // CHANNEL VIEW EVEN WHEN IT IS THREADED. A threaded message normally
    // collapses into its thread CARD here — but a question waiting on a human is
    // the one row that must not be one click away from being seen, and it is a
    // card in its own right rather than an exchange to open. It renders in BOTH
    // views, deliberately, which is the only duplication this builder allows.
    const escalationRow = escalationRowFor(message, index, answers, formatTime);
    if (escalationRow) {
      rows.push(escalationRow);
      // ⚠ `previous = null` for `ThreadCardRow`'s reason (F-251): a card has no
      // pill, so leaving the run open would absorb the next message into it.
      previous = null;
      continue;
    }
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
      // ⚠ The seen-set carries BOTH identities. The GROUP key alone would draw
      // N cards for one request — but only OPENERS carry `fanoutGroup` (the
      // server strips it from every other post), so a group-only key lets the
      // thread's replies re-emit the card as their own. Every member thread's
      // id is marked when the card is drawn, so a reply suppresses whichever
      // identity it arrives under.
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

/** THE THREAD VIEW's rows: only the messages tagged for that thread. */
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
      // ⚠ `previous` is UNCHANGED across a receipt: it is not authored, so it
      // must neither break nor extend the run of messages around it.
      continue;
    }
    rows.push(toMessageRow(message, previous, index, formatTime));
    previous = message;
  }
  return rows;
}

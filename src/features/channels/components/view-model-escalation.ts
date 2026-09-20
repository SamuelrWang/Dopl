/**
 * Channels — THE ESCALATION ROW: an agent's structured question to a human, as
 * the transcript's builders see it.
 *
 * ⚠ ITS OWN FILE FOR §1's REASON: this moves when the ESCALATION product moves,
 * where `view-model-rows.ts` moves when a MESSAGE row's shape does. ⚠ IT DEPENDS
 * ON `view-model.ts` AND NOT ON `view-model-rows.ts`, which keeps the two row
 * modules acyclic — why `personFor` / `labelFor` moved down to the base layer.
 */

import { mentionedUserIdsOf } from "../lib/mentions";
import { authorViewOf } from "../lib/desktop-handle";
import { authorAgentIdOf } from "./agents-model";
import {
  escalationAnswerOf,
  escalationOf,
  labelFor,
  personFor,
  type AuthorIndex,
} from "./view-model";
import type { ChannelEscalation } from "../escalation";
import type { ChannelMessage } from "../types";
import type { AvatarPerson } from "@/shared/ui/avatar";

/** Which side of the transcript a row hangs on. A local alias of the same two
 *  words `view-model-rows.ts` exports, so this module need not import from the
 *  file that imports it. */
type MessageSide = "peer" | "me";

/**
 * A STRUCTURED ESCALATION — an agent's question to a human, rendered as a card
 * with option buttons.
 *
 * ⚠ ITS OWN ROW KIND, decided on RESERVED METADATA (`view-model.ts ›
 * escalationOf`), not on `ChannelMessage.kind`: the message stays `kind='message'`
 * because `dopl-desktop-app/main/targeting.js › classify` returns `ignore` for
 * every other kind, so a card on one could never notify the human it asks.
 *
 * ⚠ WHO MAY ANSWER IS A PROPERTY OF THE ESCALATION, NOT OF THE VIEWER'S ROLE:
 * {@link EscalationRow.answerable} is true only for a member it TAGGED, else its
 * author's operator. The fence is SERVER-SIDE
 * (`server/service-writes-metadata-escalation.ts › escalationAnswerers`, 403); this
 * flag only decides whether buttons are DRAWN, and must be the same predicate.
 */
export interface EscalationRow {
  kind: "escalation";
  id: string;
  seq: number;
  side: MessageSide;
  author: AvatarPerson;
  authorLabel: string;
  time: string;
  /**
   * **AN AGENT WROTE IT**, and **WHICH AGENT** when the writer stamped one —
   * the two fields `view-model-rows.ts › MessageRow` carries, under the same
   * contract and read by the same predicate (`agent-box-rule.ts › agentBoxOf`).
   *
   * ⚠ **THEY ARE HERE FOR THE CARD'S BAR COLOUR** (Samuel, 2026-09-20: the bar
   * wears the posting agent's colour, black when that agent has ended). ⚠ **AND
   * THE COLOUR ITSELF IS NOT A FIELD**: a key returns to the channel's bank when
   * a session ends, so it is resolved at RENDER off the live index, exactly as
   * an agent's display name is.
   */
  agent: boolean;
  agentId: string | null;
  /** An OUTSIDE SESSION wrote it — a Claude Code / Codex / Cursor run on the
   *  operator's own token. ⚠ Forwarded, never re-derived: the one projection is
   *  `lib/desktop-handle.ts › authorViewOf`, and the chip it drives REPLACES the
   *  word "agent" rather than qualifying it (`attribution-pill.tsx`). */
  external: boolean;
  /** The four fields, as the server stamped them. */
  escalation: ChannelEscalation;
  /** This viewer is one of the members it asked. */
  answerable: boolean;
  /**
   * The answer, when one is already in this transcript page.
   *
   * ⚠ `null` MEANS "NOT IN THIS PAGE", NEVER "UNANSWERED": the transcript is a
   * WINDOW (`constants.ts › CHANNEL_TRANSCRIPT_LINE_BUDGET` — ESTIMATED RENDERED
   * LINES since 2026-09-08, not a row count), and scroll-up paging cannot close
   * that since an answer is always NEWER. So the card never says "waiting"; it
   * shows the buttons, and the server's 409 settles a genuine race.
   */
  answer: EscalationAnswerSummary | null;
  /** The server-stamped mention set names this viewer — the transcript's one
   *  source for "am I tagged here", shared with the Tags inbox. */
  mentionsMe: boolean;
}

/** What an answered card says: which option, and who chose it. */
export interface EscalationAnswerSummary {
  optionIndex: number;
  byLabel: string;
}

/**
 * WHICH ESCALATIONS ALREADY HAVE AN ANSWER IN THIS PAGE, keyed by the
 * escalation's message id.
 *
 * ⚠ A PRE-PASS, like `groupThreads`: an escalation is drawn where it was posted
 * and must already know whether it was answered, and the answer is a LATER row.
 * ⚠ FIRST ANSWER WINS — the server's rule restated
 * (`channel_messages_escalation_answer_key` refuses a second at rest), so a page
 * carrying two cannot pick a different one than the agent was woken with.
 */
export function answersByEscalation(
  messages: ChannelMessage[],
  index: AuthorIndex
): Map<string, EscalationAnswerSummary> {
  const answers = new Map<string, EscalationAnswerSummary>();
  for (const message of messages) {
    const answer = escalationAnswerOf(message);
    if (!answer) continue;
    if (answers.has(answer.escalationMessageId)) continue;
    answers.set(answer.escalationMessageId, {
      optionIndex: answer.optionIndex,
      byLabel: labelFor(message, index),
    });
  }
  return answers;
}

/**
 * A message plus its parsed escalation → the row.
 *
 * ⚠ ONE BUILDER FOR BOTH VIEWS — a card that appeared in the channel transcript
 * and not the thread one is the "where did my question go" report.
 */
export function toEscalationRow(
  message: ChannelMessage,
  escalation: ChannelEscalation,
  index: AuthorIndex,
  answers: Map<string, EscalationAnswerSummary>,
  formatTime: (iso: string) => string
): EscalationRow {
  // ⚠ THE SAME PREDICATE THE SERVER ENFORCES
  // (`server/service-writes-metadata-escalation.ts › escalationAnswerers`): the
  // members it TAGGED, else its author. A looser rule draws a control that 403s.
  const tagged = mentionedUserIdsOf(message.metadata);
  const answerers =
    tagged.length > 0
      ? tagged
      : message.authorUserId
        ? [message.authorUserId]
        : [];
  return {
    kind: "escalation",
    id: message.id,
    seq: message.seq,
    side: message.authorUserId === index.currentUserId ? "me" : "peer",
    // ⚠ THE SAME TWO LINES `view-model-rows.ts › toMessageRow` writes, and the
    // `authorKind` guard is load-bearing on BOTH: a human post may carry any
    // `client_msg_id` the client chose, including one shaped like the agent
    // stamp, so reading the id unconditionally would let a caller hang an
    // agent's identity — and its colour — off their own words.
    agent: message.authorKind === "agent",
    agentId: message.authorKind === "agent" ? authorAgentIdOf(message) : null,
    external: authorViewOf(message) === "external",
    author: personFor(message, index),
    authorLabel: labelFor(message, index),
    time: formatTime(message.createdAt),
    escalation,
    answerable: answerers.includes(index.currentUserId),
    answer: answers.get(message.id) ?? null,
    mentionsMe: tagged.includes(index.currentUserId),
  };
}

/**
 * The row for this message, or `null` when it is not an escalation — the one
 * call both builders make.
 */
export function escalationRowFor(
  message: ChannelMessage,
  index: AuthorIndex,
  answers: Map<string, EscalationAnswerSummary>,
  formatTime: (iso: string) => string
): EscalationRow | null {
  const escalation = escalationOf(message);
  if (!escalation) return null;
  return toEscalationRow(message, escalation, index, answers, formatTime);
}

/**
 * THE ESCALATION A SENT ROW CARRIES, with the MESSAGE ID beside it — the AGENT
 * STREAM's reader (`agent-stream-model.ts › StreamItem.escalation`).
 *
 * ⚠ THE ID RIDES THE PAYLOAD RATHER THAN BEING PARSED BACK OUT OF
 * `StreamItem.key` (`m:<id>`, declared in the stream model): a renderer slicing it
 * would be a second hand-written statement of one wire format. ⚠ IT LIVES HERE,
 * NOT IN THE STREAM MODEL, so both row pipelines read the reserved key through ONE
 * module.
 */
export function escalationStreamPayload(
  message: ChannelMessage
): { messageId: string; payload: ChannelEscalation } | undefined {
  const payload = escalationOf(message);
  return payload ? { messageId: message.id, payload } : undefined;
}

/**
 * Channels v2 — THE ESCALATION ROW: an agent's structured question to a human,
 * as the transcript's builders see it.
 *
 * ⚠ ITS OWN FILE FOR §1's REASON, and the 500-line cap on `view-model-rows.ts`
 * is only what forced the question. This moves when the ESCALATION product
 * moves — who may answer, what an answered card shows, whether an answer far
 * down the page still counts — where `view-model-rows.ts` moves when a MESSAGE
 * row's shape moves. Same seam, same precedent, as `view-model-requested.ts`.
 *
 * ⚠ IT DEPENDS ON `view-model.ts` AND NOT ON `view-model-rows.ts`, which is what
 * keeps the two row modules acyclic. `personFor` / `labelFor` moved down to the
 * base layer in the same change for exactly that reason.
 */

import { mentionedUserIdsOf } from "../../lib/mentions";
import {
  escalationAnswerOf,
  escalationOf,
  labelFor,
  personFor,
  type AuthorIndex,
} from "./view-model";
import type { ChannelEscalation } from "../../escalation";
import type { ChannelMessage } from "../../types";
import type { AvatarPerson } from "@/shared/ui/avatar";

/** Which side of the transcript a row hangs on. Re-declared as a local alias of
 *  the same two words `view-model-rows.ts` exports, so this module does not have
 *  to import from the file that imports it. */
type MessageSide = "peer" | "me";

/**
 * A STRUCTURED ESCALATION — an agent's question to a human, rendered as a card
 * with option buttons.
 *
 * ⚠ ITS OWN ROW KIND, decided on RESERVED METADATA rather than on
 * `ChannelMessage.kind` — `view-model.ts › escalationOf`, the same shape
 * `threadIdOf` already has. The message stays `kind='message'` on purpose:
 * `dopl-desktop-app/main/targeting.js › classify` returns `ignore` for every
 * other kind, so a card on one could never notify the human it is asking.
 *
 * ⚠ WHO MAY ANSWER IS A PROPERTY OF THE ESCALATION, NOT OF THE VIEWER'S ROLE.
 * {@link EscalationRow.answerable} is true only for a member the escalation
 * TAGGED, or — when it tagged nobody — for its author's operator. The fence is
 * SERVER-SIDE (`server/service-writes-metadata-escalation.ts ›
 * escalationAnswerers`, 403 on a violation); this flag decides only whether the
 * buttons are DRAWN, and it must be the same predicate or a member sees controls
 * that can only refuse.
 */
export interface EscalationRow {
  kind: "escalation";
  id: string;
  seq: number;
  side: MessageSide;
  author: AvatarPerson;
  authorLabel: string;
  time: string;
  /** The four fields, as the server stamped them. */
  escalation: ChannelEscalation;
  /** This viewer is one of the members it asked. */
  answerable: boolean;
  /**
   * The answer, when one is already in this transcript page.
   *
   * ⚠ `null` MEANS "NOT IN THIS PAGE", NEVER "UNANSWERED". The transcript is
   * bounded (`MAX_MESSAGE_LIMIT`), so an answer far below its escalation can be
   * off the window — the same limitation the fan-out card's grouping has. The
   * card therefore never says "waiting"; it shows the buttons, and the server's
   * 409 is what settles a genuine race.
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
 * ⚠ A PRE-PASS, for the same reason `groupThreads` is one: an escalation is
 * drawn where it was posted and must already know whether it was answered, and
 * the answer is a LATER row.
 *
 * ⚠ FIRST ANSWER WINS, which is the server's rule restated
 * (`channel_messages_escalation_answer_key` refuses a second at rest). If a page
 * somehow carries two — a row written before that index existed — the transcript
 * must not pick a different one than the agent was woken with.
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
 * ⚠ ONE BUILDER FOR BOTH VIEWS. The channel and the thread transcripts are two
 * callers of the same rule, and a card that appeared in one and not the other is
 * the "where did my question go" report.
 */
export function toEscalationRow(
  message: ChannelMessage,
  escalation: ChannelEscalation,
  index: AuthorIndex,
  answers: Map<string, EscalationAnswerSummary>,
  formatTime: (iso: string) => string
): EscalationRow {
  // ⚠ THE SAME PREDICATE THE SERVER ENFORCES
  // (`server/service-writes-metadata-escalation.ts › escalationAnswerers`):
  // the members it TAGGED, else its author. Drawing buttons off a looser rule
  // would show a member a control that can only 403.
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
 * `StreamItem.key`. That key is `m:<id>` and its format is declared in the
 * stream model; a renderer slicing it would be a second hand-written statement
 * of one wire format — the defect `parseAgentPostStamp` exists as a single
 * declaration to prevent.
 *
 * ⚠ IT LIVES HERE, NOT IN THE STREAM MODEL, so the two row pipelines read the
 * reserved key through ONE module. It also keeps `agent-stream-model.ts` under
 * the §1 cap, which is what forced the question but not what answers it.
 */
export function escalationStreamPayload(
  message: ChannelMessage
): { messageId: string; payload: ChannelEscalation } | undefined {
  const payload = escalationOf(message);
  return payload ? { messageId: message.id, payload } : undefined;
}

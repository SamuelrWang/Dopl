/**
 * Channels — A MESSAGE'S DISPLAY, as both row pipelines see it (docs/specs/unified-display.md
 * §5.1/§7.3). Every stored shape — a v2 display, a v1 glasses display, a legacy decision
 * (`metadata.escalation` only) — reaches the card through ONE adapter
 * (`lib/message-device.ts › messageDisplayOf` → `display/core/adapt.ts › displayOf`); this module adds what only the page knows: the answer
 * message already in it, who may answer, and who chose.
 *
 * ⚠ IT DEPENDS ON `view-model.ts` AND NOT ON `view-model-rows.ts`, which keeps the row modules
 * acyclic.
 */

import { answerersOf } from "@/features/display/core/answerers";
import type { Display, DisplayAnswerStamp } from "@/features/display/core/types";
import { messageDisplayOf, messageSourceOf } from "../lib/message-device";
import { escalationAnswerOf, labelFor, type AuthorIndex } from "./view-model";
import type { DisplayView } from "./display-card";
import type { ChannelMessage } from "../types";

/** An answer message already in the page: the stamp it implies, and who wrote it. */
export interface PageAnswer {
  stamp: DisplayAnswerStamp;
  byLabel: string;
}

/**
 * WHICH DECISIONS ALREADY HAVE AN ANSWER IN THIS PAGE, keyed by the decision's message id.
 *
 * ⚠ A PRE-PASS: a card is drawn where it was posted and the answer is a LATER row. `displayOf`
 * prefers the message's own stamp; this covers a legacy decision (no display to stamp) and the
 * window before the server's post-insert stamp lands.
 * ⚠ FIRST ANSWER WINS — the server's rule (`channel_messages_escalation_answer_key`).
 * ⚠ ABSENT MEANS "NOT IN THIS PAGE", NEVER "UNANSWERED": the transcript is a window, so the card
 * shows its buttons and the server's 409 settles a real race.
 */
export function answersByEscalation(
  messages: readonly ChannelMessage[],
  index: AuthorIndex
): Map<string, PageAnswer> {
  const answers = new Map<string, PageAnswer>();
  for (const message of messages) {
    const answer = escalationAnswerOf(message);
    if (!answer || answers.has(answer.escalationMessageId)) continue;
    answers.set(answer.escalationMessageId, {
      stamp: {
        block_id: "",
        index: answer.optionIndex,
        choice: message.body,
        at: message.createdAt,
        via: messageSourceOf(message.metadata)?.kind ?? "web",
        ...(message.authorUserId ? { by: message.authorUserId } : {}),
        message_id: message.id,
      },
      byLabel: labelFor(message, index),
    });
  }
  return answers;
}

/** "You", the roster name, else the page's answer message label; `null` when nobody can be said. */
function answeredByOf(
  stamp: DisplayAnswerStamp | null,
  page: PageAnswer | undefined,
  index: AuthorIndex
): string | null {
  if (!stamp) return null;
  if (stamp.by === index.currentUserId) return "You";
  const member = stamp.by ? index.byId.get(stamp.by) : undefined;
  return member?.displayName ?? member?.email ?? page?.byLabel ?? null;
}

/**
 * A STORED DISPLAY, AS BOTH ROW PIPELINES CARRY IT — the adapter's `Display` plus the two stored
 * facts the page layer needs. `null` when there is no display, or one this build cannot read (the
 * body renders). ⚠ OFF THE STORED ROW ONLY — never a narration frame: the key is server-written.
 */
export interface DisplayPayload {
  messageId: string;
  channelId: string;
  display: Display;
  /** `answerersOf`: the members it TAGGED, else its author account — the server's 403 rule. */
  answerers: readonly string[];
  /** Built by `dopl_request_decision`, or a legacy decision: it keeps the old card's bar. */
  legacyDecision: boolean;
}

export function displayPayloadOf(message: ChannelMessage): DisplayPayload | null {
  const display = messageDisplayOf(message.metadata);
  if (!display) return null;
  const origin = (message.metadata.display as { origin?: unknown } | undefined)?.origin;
  return {
    messageId: message.id,
    channelId: message.channelId,
    display,
    answerers: answerersOf(message.metadata, message.authorUserId),
    legacyDecision: display.from === "escalation" || origin === "dopl_request_decision",
  };
}

/**
 * The card's view: the stored answer, else the page's answer message; whether THIS viewer may
 * answer (a looser rule draws a control that can only refuse); who chose. `saveable` is the host's
 * (the transcript offers Save on the viewer's own agent's display; the stream never does).
 */
export function displayViewFrom(
  payload: DisplayPayload,
  index: AuthorIndex,
  answers: ReadonlyMap<string, PageAnswer>,
  saveable: boolean
): DisplayView {
  const page = answers.get(payload.messageId);
  const answer = payload.display.answer ?? page?.stamp ?? null;
  return {
    display: answer === payload.display.answer ? payload.display : { ...payload.display, answer },
    answerable: payload.answerers.includes(index.currentUserId),
    answeredBy: answeredByOf(answer, page, index),
    saveable: saveable && !payload.legacyDecision,
  };
}

/** The transcript's one call: Save is offered on the viewer's own (agent's) display. */
export function displayViewOf(
  message: ChannelMessage,
  index: AuthorIndex,
  answers: ReadonlyMap<string, PageAnswer>
): DisplayView | null {
  const payload = displayPayloadOf(message);
  return payload
    ? displayViewFrom(payload, index, answers, message.authorUserId === index.currentUserId)
    : null;
}

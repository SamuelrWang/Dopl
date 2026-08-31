import { parseAgentPostStamp } from "../lib/agent-post-stamp";
import { mentionedUserIdsOf } from "../lib/mentions";
import {
  ESCALATION_ANSWER_METADATA_KEY,
  ESCALATION_METADATA_KEY,
  parseEscalation,
  type ChannelEscalationAnswerInput,
} from "../escalation";
import {
  EscalationForbiddenError,
  EscalationNotFoundError,
} from "./errors";
import * as repoMessages from "./repository-messages";
import type { ChannelMessageRow } from "./dto";

/**
 * FOLDS 10 AND 11 OF `resolvePostMetadata` — the escalation card and its answer.
 *
 * ⚠ ITS OWN MODULE FOR §1's REASON: `service-writes-metadata.ts` is the strip-
 * then-restamp pipeline and every fold in it is a few lines over data already in
 * hand. **This one READS ANOTHER ROW and enforces an authorization** — a
 * different concern with a different reason to change, and the file it would
 * otherwise grow inside is the one every reserved key lives in.
 *
 * Both keys are reserved on `fanoutGroup`'s exact terms (INVARIANTS §5):
 * stripped from caller input unconditionally by the caller of these functions,
 * and re-stamped only from validated fields.
 */

/**
 * FOLD 10 — the escalation payload.
 *
 * ⚠ TRIVIAL ON PURPOSE. The zod schema (`escalation.ts ›
 * ChannelEscalationSchema`) is the whole validation, and there is no
 * authorization question: any member who may post into a channel may ask a
 * question in it. The card's POWER is the answer, and that is fold 11's problem.
 */
export function resolveEscalation(
  input: { escalation?: unknown },
  metadata: Record<string, unknown>
): void {
  if (input.escalation === undefined) return;
  metadata[ESCALATION_METADATA_KEY] = input.escalation;
}

/**
 * The set of members entitled to ANSWER an escalation.
 *
 * ⚠ IT IS THE SERVER-STAMPED MENTION SET, ELSE THE AUTHOR — and both halves are
 * rulings (Samuel, 2026-08-31, the conservative side of the fork).
 *
 * The mention set because it is the mechanism the product ALREADY has for "this
 * needs a specific person": server-resolved, caller-unsettable, ambiguity
 * failing closed, and already wired to the Tags inbox and the desktop
 * notification. No new field, no new fence, nothing extra to keep in step.
 *
 * ⚠ IT IS DELIBERATELY **NOT** `to_user_id`. Addressing a member TRIGGERS that
 * member's listener and starts THEIR agent (INVARIANTS §5) — precisely wrong for
 * a question that exists because only a human can answer it. An @-tag is an
 * INBOX fact and starts nobody.
 *
 * The AUTHOR fallback is §5's own 2026-08-22 ruling made useful: an agent's tag
 * at its own operator is kept *because it is its escalation path to the one
 * human who can unblock it*. An untagged escalation is therefore addressed to
 * the person whose machine it runs on, which is the true default.
 *
 * ⚠ A PEER'S ESCALATION IS ANSWERABLE BY YOU EXACTLY WHEN IT TAGGED YOU, and by
 * nobody else otherwise. That is what makes another member's card render
 * read-only without a second concept.
 */
export function escalationAnswerers(row: ChannelMessageRow): string[] {
  const tagged = mentionedUserIdsOf(
    (row.metadata ?? {}) as Record<string, unknown>
  );
  if (tagged.length > 0) return tagged;
  return row.author_user_id ? [row.author_user_id] : [];
}

/**
 * FOLD 11 — the answer.
 *
 * Four checks, and the ORDER is chosen so no earlier one can be used to probe
 * for what a later one would reveal:
 *  1. the escalation row exists IN THIS CHANNEL (404 — never a 403, so an id
 *     from another room is indistinguishable from one that does not exist);
 *  2. it really carries an escalation payload (same 404 — a plain message is not
 *     an escalation and saying which it is answers nothing useful);
 *  3. `optionIndex` is inside THAT escalation's own options (404, same reason:
 *     the option count is a property of a row the caller may not be able to see
 *     the body of);
 *  4. the caller is in {@link escalationAnswerers} — **403**.
 *
 * ⚠ **403 HERE, WHERE A NON-PARTICIPANT'S THREAD TAG IS SILENTLY STRIPPED, AND
 * THE DIFFERENCE IS DELIBERATE.** §5 strips a foreign `taskId` because installed
 * desktops post legacy ids and a 403 would reject real posts from the field.
 * `escalationAnswer` has no installed writers at all, and the failure a silent
 * strip produces here is the exact one this feature exists to remove: a button
 * that reports success over an answer that reached nobody.
 *
 * ⚠ `agentId` IS DERIVED, NEVER ACCEPTED. It comes off the ESCALATION's own
 * `client_msg_id` stamp, so an answer cannot name an agent the escalation was
 * not written by — otherwise this key would be a wake primitive aimed anywhere.
 * `null` is the ordinary answer for an escalation filed by an EXTERNAL MCP
 * session (no desktop stamped it) and the answer is still an ordinary visible
 * message, so `main/session-dispatch.js › feedLiveSession` still delivers it to
 * every live agent on the thread.
 *
 * ⚠ ONE ANSWER PER ESCALATION IS ENFORCED AT REST, not here — the partial unique
 * index on `(metadata->'escalationAnswer'->>'escalationMessageId')` surfaces a
 * second one as 23505 for the service layer. A read-then-write check here would
 * be a race with a friendlier error message and no guarantee behind it.
 */
export async function resolveEscalationAnswer(
  channelId: string,
  callerUserId: string,
  answer: ChannelEscalationAnswerInput,
  metadata: Record<string, unknown>
): Promise<void> {
  const row = await repoMessages.findMessageById(
    channelId,
    answer.escalationMessageId
  );
  if (!row) throw new EscalationNotFoundError(answer.escalationMessageId);

  const escalation = parseEscalation(
    ((row.metadata ?? {}) as Record<string, unknown>)[ESCALATION_METADATA_KEY]
  );
  if (!escalation) throw new EscalationNotFoundError(answer.escalationMessageId);
  if (answer.optionIndex >= escalation.options.length) {
    throw new EscalationNotFoundError(answer.escalationMessageId);
  }

  if (!escalationAnswerers(row).includes(callerUserId)) {
    throw new EscalationForbiddenError();
  }

  metadata[ESCALATION_ANSWER_METADATA_KEY] = {
    escalationMessageId: row.id,
    optionIndex: answer.optionIndex,
    agentId: parseAgentPostStamp(row.client_msg_id),
  };
}

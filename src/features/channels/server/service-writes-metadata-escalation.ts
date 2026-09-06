import { authorAgentIdOf } from "../lib/agent-post-stamp";
import { mentionedUserIdsOf } from "../lib/mentions";
import {
  ESCALATION_ANSWER_METADATA_KEY,
  ESCALATION_METADATA_KEY,
  ESCALATION_OPTION_LABEL_MAX,
  parseEscalation,
  type ChannelEscalation,
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
 * ⚠ `agentId` IS DERIVED, NEVER ACCEPTED. It comes off the ESCALATION ROW's own
 * authorship, so an answer cannot name an agent the escalation was not written
 * by — otherwise this key would be a wake primitive aimed anywhere.
 *
 * ⚠ **BOTH DOORS, SINCE 2026-09-05 — `lib/agent-post-stamp.ts › authorAgentIdOf`,
 * NOT `parseAgentPostStamp` ALONE.** The stamp answers `null` for every post that
 * carried its own idempotency key, because `main/session-outbound-tag.js ›
 * threadTagFor` deliberately never overwrites one an agent chose. So an agent
 * that filed its decision card with `client_msg_id: "ask-2"` was ANONYMOUS here:
 * the card stamped `agentId: null`, and the press that answered it named nobody
 * to wake. That is this feature's own failure mode restated — a button reporting
 * success over an answer that reached no one — and it fired on exactly the
 * careful callers who set an idempotency key before retrying.
 *
 * ⚠ **AND THE SECOND DOOR IS THE STRONGER FACT, SO THE DERIVED-NEVER-ACCEPTED
 * PROPERTY IS WIDENED RATHER THAN LOOSENED.** `client_msg_id` is whatever the
 * caller sent; `metadata.session_id` is stripped from caller input
 * unconditionally and re-stamped from the `X-Dopl-Session-Id` header
 * (`service-writes-metadata.ts` fold 6b), so it cannot be posed at all. Reading
 * it names FEWER forgeable things than the stamp did, not more.
 *
 * `null` is still the ordinary answer for an escalation filed by an EXTERNAL MCP
 * session (nothing stamped it and it carries no desktop session key) and the
 * answer is still an ordinary visible message, so `main/session-dispatch.js ›
 * feedLiveSession` still delivers it to every live agent on the thread.
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

  stampEscalationAnswer(row, answer.optionIndex, metadata);
}

/**
 * THE ONE PLACE THE ANSWER KEY IS WRITTEN — both doors end here.
 *
 * ⚠ THAT IS THE POINT, NOT A TIDY-UP (#1085 ›3): "when the typed match fires,
 * stamp `escalationAnswer` identically to a button press, so the wake verdict
 * never learns there were two entrances." A second stamping site is how the two
 * entrances drift — one of them keeping the weaker `agentId` reader, say, which
 * is precisely the bug task 13a just repaired.
 */
function stampEscalationAnswer(
  row: ChannelMessageRow,
  optionIndex: number,
  metadata: Record<string, unknown>
): void {
  metadata[ESCALATION_ANSWER_METADATA_KEY] = {
    escalationMessageId: row.id,
    optionIndex,
    agentId: authorAgentIdOf({
      clientMsgId: row.client_msg_id,
      metadata: (row.metadata ?? {}) as Record<string, unknown>,
    }),
  };
}

/**
 * THE TYPED DOOR — which option, if any, this body IS.
 *
 * ⚠ EXACT, AND EVERY LOOSER RULE WAS REFUSED ON PURPOSE (#1085 ›2). The whole
 * body, trimmed, case-insensitively equal to ONE option's whole label; or the
 * bare 1-based number the body render already prints beside it
 * (`escalationBody`: "1. **Ship now** — …"). Partial text, a label inside a
 * sentence, and two options that match are all `null`, because a wrong match
 * PRESSES A BUTTON THE PERSON DID NOT PRESS — worse than the gap this closes,
 * and unrecoverable through a UI that has no unpress.
 *
 * ⚠ **THE LABEL IS TRIED FIRST AND THE NUMBER IS THE FALLBACK** (ruled
 * 2026-09-06). The digit arm used to run first, which made the sentence above
 * FALSE for one shape: an option faced `"2"` or `"2026"` could never be answered
 * by typing its own face, because the digits were spent reading a POSITION
 * before anything looked at the labels. There is no card on which that reading
 * was the only available one — the person is typing what they SEE, and a label
 * is the more specific thing to have seen. So: whole-label match wins, and the
 * 1-based index answers only when NO label matched.
 *
 * ⚠ **AMBIGUITY DOES NOT FALL THROUGH TO THE NUMBER.** Two options sharing a
 * face is `null` and STOPS there. Reading "2" as a position after two options
 * called "2" refused would be the guess this function exists not to make, taken
 * one step later.
 *
 * ⚠ THE NUMBER IS STILL 1-BASED IN, 0-BASED OUT. It is read off what the operator
 * SEES (the rendered list), never off `options` directly; "0" is therefore not an
 * answer, and neither is "3" on a two-option card.
 */
export function matchTypedOption(
  escalation: ChannelEscalation,
  body: string
): number | null {
  const typed = body.trim();
  if (!typed) return null;

  const wanted = typed.toLowerCase();
  const hit = escalation.options.reduce<number[]>((acc, option, i) => {
    if (option.label.trim().toLowerCase() === wanted) acc.push(i);
    return acc;
  }, []);
  if (hit.length === 1) return hit[0];
  // ⚠ TWO MATCHES IS NO MATCH. A card may legally carry two options with the
  // same face, and "the person meant one of them" is not something this may
  // guess — nor may the digit arm below guess it for us, which is why this
  // returns rather than breaking.
  if (hit.length > 1) return null;

  // NO LABEL MATCHED — now the bare number may speak, and on an ordinary card
  // (no numeric faces) it reaches exactly what it always did.
  if (/^\d+$/.test(typed)) {
    const index = Number(typed) - 1;
    return index >= 0 && index < escalation.options.length ? index : null;
  }

  return null;
}

/**
 * FOLD 11b — THE TYPED ANSWER (2026-09-05, task 13b, rulings #1081–#1085).
 *
 * The gap it closes: Samuel answered a card by typing "Approve the package" as
 * an ordinary message. It carried no `escalationAnswer`, so it tied to no card
 * and woke nobody — and #1084's finding is that this was never a regression,
 * the typed path was never built at all.
 *
 * ⚠ IT IS AN ANSWER WRITE, NOT A WAKE VERDICT, and it touches no routing. It
 * stamps the same key a press stamps and then gets out of the way; everything
 * downstream — who is woken, how the answer is delivered — is unchanged and
 * cannot tell the two doors apart.
 *
 * ⚠ EVERY NEAR MISS IS SILENT. No error, no hint, no "did you mean". The message
 * is simply an ordinary message, which is what it already was: the feature can
 * only ever ADD a stamp, never refuse a post. That is why nothing here throws,
 * unlike {@link resolveEscalationAnswer} — a hostile caller cannot reach this
 * path with a forged id, so there is nothing to refuse, and a throw here would
 * turn a member's ordinary sentence into a failed send.
 *
 * ⚠ AUTHORIZATION IS THE CANDIDATE FILTER, not a separate check. A card is a
 * candidate only if {@link escalationAnswerers} names the typist, so the typed
 * door can never answer a card the button would have refused with a 403.
 *
 * ⚠ MOST RECENT **OPEN** ONE, never "any open card" (#1085 ›2). A verbatim label
 * is strong intent even days later, so there is no time bound; most-recent-only
 * is what stops one label pressing a button on some older card that happened to
 * share it.
 *
 * ⚠ **IT ANSWERS WHETHER IT STAMPED, AND THE INSERT NEEDS THAT** (2026-09-06).
 * "Never refuse a post" is a claim about the WRITE, not only about this
 * function: the open-card check above is a read, the unique index over the
 * answered escalation id is enforced at COMMIT, and a second answer landing in
 * between turns this member's plain sentence into a failed send with a 23505.
 * `service-writes.ts` drops the stamp and re-inserts on exactly that race, and
 * this boolean is how it knows the key was ITS OWN guess rather than the
 * caller's `escalationAnswer` — which must still 409, because a PRESS that lost
 * the race is a decision that did not take.
 */
export async function resolveTypedEscalationAnswer(
  channelId: string,
  callerUserId: string,
  body: string,
  metadata: Record<string, unknown>
): Promise<boolean> {
  const typed = body.trim();
  // ⚠ THE FREE PRUNE, AND IT IS WHY THE POST PATH DOES NOT PAY FOR THIS. Every
  // message in every channel reaches this fold, and two reads on each would be a
  // real cost for a rare event. An option label is a `safeLabel` — single line,
  // ≤ 80 chars — so anything longer or multi-line CANNOT equal one, and ordinary
  // prose is refused here without touching the database.
  if (!typed || typed.length > ESCALATION_OPTION_LABEL_MAX) return false;
  if (typed.includes("\n")) return false;

  // ⚠ THE LOOKUP MAY FAIL AND THE POST MAY NOT. This fold can only ever ADD a
  // stamp (see above), so the honest behaviour when the candidate reads cannot
  // answer — a database blip, a timeout — is the SAME silence every near miss
  // gets: the message is ordinary prose, which is what it already was. The
  // alternative is a member's ordinary sentence failing to send because an
  // optional convenience could not run, and that trade is not close.
  //
  // ⚠ NARROW ON PURPOSE: it covers the two READS and nothing else. The match and
  // the stamp below are pure and total, so a throw from either would be a real
  // defect and must not be swallowed here.
  // ⚠ Initialized rather than declared: the `catch` returns, so nothing reads a
  // default — it only spares the reader (and the compiler's definite-assignment
  // analysis) a question about a variable assigned inside a `try`.
  let answerable: ChannelMessageRow[] = [];
  let answered: Set<string> = new Set<string>();
  try {
    const recent = await repoMessages.listRecentEscalations(channelId);
    answerable = recent.filter((row) =>
      escalationAnswerers(row).includes(callerUserId)
    );
    if (answerable.length === 0) return false;
    answered = await repoMessages.listAnsweredEscalationIds(
      channelId,
      answerable.map((row) => row.id)
    );
  } catch {
    return false;
  }
  // `listRecentEscalations` is `seq` DESC and both steps preserve it, so the
  // first survivor IS the most recent open one.
  const open = answerable.find((row) => !answered.has(row.id));
  if (!open) return false;

  const escalation = parseEscalation(
    ((open.metadata ?? {}) as Record<string, unknown>)[ESCALATION_METADATA_KEY]
  );
  if (!escalation) return false;

  const optionIndex = matchTypedOption(escalation, typed);
  if (optionIndex === null) return false;

  stampEscalationAnswer(open, optionIndex, metadata);
  return true;
}

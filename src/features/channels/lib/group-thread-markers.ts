/**
 * Thread grouping — THE RESERVED METADATA MARKERS, READ SIDE. Every predicate
 * answers one question: what does this message's metadata DECLARE about the
 * session, independent of its body. Wire contract agreed with
 * `server/service-writes-metadata-markers.ts`.
 *
 * ⚠ TWO RULES HOLD FOR EVERY MARKER HERE:
 *
 * 1. STRICT `=== true`, NEVER truthiness. `metadata` is an unbounded `z.record`
 *    on the wire, so a truthy-but-not-true value ("yes", 1, {}) is
 *    caller-influenceable; letting one pass disguises a real failure as a calm
 *    outcome, or narrates somebody else's thread as reopened.
 *
 * 2. THE KIND IS CHECKED TOO where the kind IS the guarantee. A marker that must
 *    never become the exchange's OUTCOME rides on `task_progress` by
 *    construction (`groupThread` can only make an `endEvent` from a terminal
 *    kind). Reading the flag off a terminal kind launders exactly the shape the
 *    construction prevents, so `isSessionEndedMarker` REQUIRES `task_progress`.
 *
 * ⚠ WHAT LEFT, AND WHAT DID NOT (wiring plan Phase 4, 2026-08-18). The REOPEN
 * marker (`THREAD_REOPENED_KEY` / `isThreadReopenedMarker`) was deleted with
 * thread closing — no reopen, no echo, no reader. The CALM TERMINAL reads below
 * SURVIVED, and the distinction is what they describe: a calm flag says ONE
 * MEMBER'S SESSION ended (`declined` still written by the desktop's consent DENY
 * echo, `ended` by the operator End), which is not, and never was, an outcome
 * for the shared thread. Deleting them would have taken the Declined receipt and
 * the muted chip with them.
 */

import type { ChannelMessage } from "../types";
import type { SessionStatus } from "./group-thread-types";

/**
 * The calm terminal states — operator-chosen endings that share the muted
 * (never alarm-red) chip treatment. `failed` is intentionally NOT here.
 */
const CALM_TERMINAL_STATUSES: ReadonlySet<SessionStatus> = new Set([
  "declined",
  "dropped",
  "interrupted",
  "capped",
  "ended",
]);

/**
 * Calm SESSION-END states — a running session that stopped without a reply.
 * ⚠ A strict SUBSET of the calm terminals: `declined`/`dropped` are
 * request-level decisions (work never ran) and are excluded, so only these three
 * replace a lying "Working…" line on an open-task card.
 */
const CALM_SESSION_END_STATUSES: ReadonlySet<SessionStatus> = new Set([
  "interrupted",
  "capped",
  "ended",
]);

/** True for the operator-chosen calm terminal outcomes (declined/dropped/interrupted). */
export function isCalmTerminalStatus(status: SessionStatus): boolean {
  return CALM_TERMINAL_STATUSES.has(status);
}

/**
 * Map a terminal marker to the calm status it announces, else null (a genuine
 * failure). The desktop encodes an operator-chosen ending as `task_failed` +
 * a boolean flag: `declined` (consent denied), `dropped` (send cancelled),
 * `interrupted` (app died mid-spawn), `capped` (turn/cost cap), `ended`
 * (operator ended the session). ⚠ Each read STRICTLY `=== true`.
 */
export function calmTerminalStatus(message: ChannelMessage): SessionStatus | null {
  if (message.kind !== "task_failed") return null;
  const { metadata } = message;
  if (metadata.declined === true) return "declined";
  if (metadata.dropped === true) return "dropped";
  if (metadata.interrupted === true) return "interrupted";
  if (metadata.capped === true) return "capped";
  if (metadata.ended === true) return "ended";
  return null;
}

/**
 * Calm SESSION-END status a terminal marker announces, else null. Strict subset
 * of {@link calmTerminalStatus} excluding request-level `declined`/`dropped`.
 * Drives the honest "Working…" replacement.
 */
export function calmSessionEndStatus(message: ChannelMessage): SessionStatus | null {
  const status = calmTerminalStatus(message);
  return status !== null && CALM_SESSION_END_STATUSES.has(status) ? status : null;
}

/**
 * ⚠ A LOCAL SESSION ENDING IS NOT AN OUTCOME FOR THE SHARED THREAD. Mapping "the
 * operator closed this window" onto `task_failed` + a calm flag keeps the CHIP
 * calm but the KIND is terminal: `groupThread` folds `task_failed` into
 * `draft.endEvent` and `computeStatus` reads it as the exchange's outcome, so the
 * peer's card reports the THREAD ended when one machine's window did.
 *
 * ⚠ NON-TERMINAL BY CONSTRUCTION, not by flag: rides on `task_progress`, which
 * `groupThread` treats as an ENTRY and never an `endEvent`. The flag only
 * decides how the card WORDS it.
 *
 * ⚠ No migration, and that was the deciding constraint: `channel_messages.kind`
 * has a CHECK over `message | task_started | task_progress | task_finished |
 * task_failed | system`, so a first-class `session_ended` KIND is a schema change
 * shipped ahead of every writer, for a render hint. Reserved on the same terms
 * as `service-writes-metadata.CALM_FLAG_KEYS`.
 */
export const SESSION_ENDED_KEY = "session_ended";

/** True for the non-terminal "this member's session stopped" marker. */
export function isSessionEndedMarker(message: ChannelMessage): boolean {
  return (
    message.kind === "task_progress" &&
    message.metadata[SESSION_ENDED_KEY] === true
  );
}

/**
 * ⚠ `THREAD_REOPENED_KEY` + `isThreadReopenedMarker` USED TO LIVE HERE — the
 * read side of the REOPEN ECHO. `channel_tasks` is in neither realtime table
 * set, so a status change reached no peer surface by itself and `reopenTask`
 * rang the `channel_messages` doorbell with a `task_progress` carrying
 * `threadReopened:true`. DELETED with thread closing (wiring plan Phase 4,
 * 2026-08-18): the service, the reserved write-side key and the notices-lane
 * routing all went in the same change.
 *
 * Two rules it demonstrated are still live in this file and worth not
 * relearning: a marker that must never become the exchange's OUTCOME rides a
 * NON-TERMINAL kind by construction, and status is decided by FLAG rather than
 * by matching server-generated body copy.
 */

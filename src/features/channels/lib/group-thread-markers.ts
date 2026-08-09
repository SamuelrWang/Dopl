/**
 * Thread grouping — THE RESERVED METADATA MARKERS, READ SIDE.
 *
 * Every predicate here answers one question: what does this message's metadata
 * DECLARE about the session, independent of what its body happens to say. That
 * is a different reason to change than the grouping state machine (`group-thread.ts`)
 * or the lane split (`group-thread-render.ts`): a new marker is a wire-contract
 * addition, agreed with `server/service-writes-metadata-markers.ts`, and it lands
 * here whether or not any routing rule moves.
 *
 * TWO RULES HOLD FOR EVERY MARKER IN THIS FILE, and both are load-bearing:
 *
 * 1. **STRICT `=== true`.** Never truthiness. `metadata` is an unbounded
 *    `z.record` on the wire, so a truthy-but-not-true value ("yes", 1, {}) is
 *    something a caller can influence; letting one pass would disguise a real
 *    failure as a calm outcome, or narrate somebody else's thread as reopened.
 *    The server strips each of these keys from caller metadata unconditionally
 *    and re-stamps them itself — this side is the belt to that server-side brace.
 *
 * 2. **THE KIND IS CHECKED TOO, where the kind is the guarantee.** A marker that
 *    must never become the exchange's OUTCOME rides on `task_progress` BY
 *    CONSTRUCTION (`groupThread` can only make an `endEvent` out of a terminal
 *    kind). Reading the flag off a terminal kind would launder exactly the shape
 *    the construction exists to prevent, so `isSessionEndedMarker` and
 *    `isThreadReopenedMarker` both require `task_progress`.
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
 * The calm SESSION-END states — a running session that stopped without a reply
 * (app died, cap hit, operator ended it). A strict SUBSET of the calm terminals:
 * `declined`/`dropped` are request-level decisions (work never ran), excluded so
 * only these three replace a lying "Working…" line on an open-task card.
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
 * Map a terminal marker to the calm terminal status it announces, or null when
 * it is a genuine failure. The desktop encodes an operator-chosen ending as a
 * `task_failed` carrying a boolean metadata flag (no schema change): `declined`
 * (consent denied), `dropped` (outbound send cancelled), `interrupted` (app died
 * mid-spawn), `capped` (a turn/cost cap was reached), or `ended` (the operator
 * ended the session on the desktop). Each flag is read STRICTLY (`=== true`) so
 * an attacker-influenceable truthy value (e.g. the string "yes") can never
 * disguise a real failure as a calm outcome. A `task_failed` with none of the
 * flags returns null and stays a genuine `failed`.
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
 * The calm SESSION-END status a terminal marker announces (interrupted/capped/
 * ended), or null — a strict subset of {@link calmTerminalStatus} that excludes
 * the request-level `declined`/`dropped`. Drives the honest "Working…"
 * replacement so a session that stopped mid-work stops claiming it is working.
 */
export function calmSessionEndStatus(message: ChannelMessage): SessionStatus | null {
  const status = calmTerminalStatus(message);
  return status !== null && CALM_SESSION_END_STATUSES.has(status) ? status : null;
}

/**
 * P1-7 (Samuel's decision 3, 2026-08-04) — A LOCAL SESSION ENDING IS NOT AN
 * OUTCOME FOR THE SHARED THREAD.
 *
 * `session-effects.endLifecycle('operator')` used to map "the operator closed
 * this window" onto `task_failed` + `{ ended: true }`. The flag kept the CHIP
 * calm, but the KIND is terminal: `groupThread` folds a `task_failed` into
 * `draft.endEvent`, `computeStatus` reads a terminal marker as the exchange's
 * outcome, and the peer's card therefore reported that the THREAD had ended when
 * what ended was one machine's window. The thread had not failed and had not
 * finished; it was still open, still routing, and the other member could still be
 * working it.
 *
 * THE SIGNAL IS NON-TERMINAL BY CONSTRUCTION, not by flag: it rides on
 * `task_progress`, which `groupThread` treats as an ENTRY and never as an
 * `endEvent`, so there is no path by which it can become the exchange's outcome.
 * The flag then only decides how the card WORDS it.
 *
 * NO MIGRATION, and that was the deciding constraint. `channel_messages.kind`
 * carries a CHECK constraint (`'message','task_started','task_progress',
 * 'task_finished','task_failed','system'` — verified against the live database),
 * so a first-class `session_ended` KIND is a schema change, deployed ahead of
 * every desktop that would write it, for what is a render hint. A reserved
 * metadata marker on an existing kind buys the same distinction with none of
 * that — the same trade the five calm flags already made, and it is reserved on
 * the same terms (`service-writes-metadata.CALM_FLAG_KEYS`): stripped from caller
 * metadata unconditionally and re-stamped only onto a thread tag the poster is
 * entitled to, so nobody can narrate somebody else's thread as stopped.
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
 * C-26 (2026-08-08, F-176) — THE REOPEN ECHO, and why the renderer has to know
 * about it by name.
 *
 * `channel_tasks` is in NEITHER realtime table set, so a status change reaches no
 * peer surface by itself; close survived that only by accident of POSTING its
 * terminal marker, and reopen posted nothing at all. The fix was to make reopen
 * ring the same `channel_messages` doorbell: `service-tasks-lifecycle.reopenTask`
 * posts `kind:"task_progress"`, body `Thread reopened (was closed as …).`,
 * `metadata:{ taskId, threadReopened:true }`. The mirror of this key on the write
 * side is `server/service-writes-metadata-markers.REOPEN_MARKER_KEY`, where it is
 * RESERVED: stripped from caller metadata unconditionally and re-stamped only from
 * `PostMessageOptions.reopened`, onto a thread tag that survived the participation
 * gate. That reservation is what makes it safe to render off the flag here — a
 * marker on the wire is a reopen the server performed, never a claim a peer typed.
 *
 * ⚠ **THE KIND IS NOT NEGOTIABLE AND THIS FILE DOES NOT TOUCH IT.** `task_progress`
 * was chosen so the echo can never become an `endEvent` (and so `task_started`
 * cannot take over `draft.head` or open the fallback window). The bug this
 * predicate fixes is purely a RENDERING one, one layer up: `splitSessionEntries`
 * routed every `task_progress` to the milestones lane, so a thread that had just
 * come back to LIFE announced itself with a green ✓ in a list titled
 * "Milestones" — the card's word for finished work. A resumption is the opposite
 * of an accomplishment, and reading it as one is worse on a reopened thread than
 * on any other, because "reopened" is precisely the state the ✓ denies.
 *
 * The rule is the one `substantiveEndBody` already follows and states: **STATUS
 * IS DECIDED BY FLAG, NOT BY STRING.** The echo's body is server-generated and
 * will be re-worded (it already has two forms, with and without a prior outcome);
 * a renderer that recognised it by matching `"Thread reopened"` would silently
 * regress to the ✓ the first time somebody improved the copy.
 */
export const THREAD_REOPENED_KEY = "threadReopened";

/**
 * True for the server-stamped "this thread was reopened" echo — a `task_progress`
 * carrying {@link THREAD_REOPENED_KEY} strictly. It is STATUS, not a milestone:
 * see {@link THREAD_REOPENED_KEY} and `splitSessionEntries`'s notices lane.
 */
export function isThreadReopenedMarker(message: ChannelMessage): boolean {
  return (
    message.kind === "task_progress" &&
    message.metadata[THREAD_REOPENED_KEY] === true
  );
}

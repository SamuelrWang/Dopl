/**
 * THE CALM TERMINAL READ — what a `task_failed` row's metadata DECLARES about a
 * session's ending, independent of its body.
 *
 * ⚠ THIS IS THE SURVIVOR OF `lib/group-thread-markers.ts`, WHICH IS DELETED
 * (wiring plan Phase 5, 2026-08-18) along with the whole `group-thread*` family
 * and the session card it fed. It got its own module rather than a home inside
 * one of its two callers because it has two, and the second copy is how they
 * come to disagree about what counts as a calm ending.
 *
 * WHAT WENT WITH THE FAMILY, and it is worth not relearning: the grouping state
 * machine, the render/draft accumulators, `SessionGroup` / `ThreadItem` /
 * `ThreadOverlay`, `calmSessionEndStatus`, `isCalmTerminalStatus`,
 * `isSessionEndedMarker` and `SESSION_ENDED_KEY`. Every one of them existed to
 * turn lifecycle rows into a CARD, and with an agent's run state living in the
 * agent view there is nothing left to group. The reserved WRITE-side keys are a
 * different question and did NOT go: `service-writes-metadata-markers.ts ›
 * CALM_FLAG_KEYS` stays whole, because the strip is what keeps them unforgeable
 * (INVARIANTS §5) and stored rows still carry them.
 *
 * ⚠ WHY THIS READ IS STILL LIVE, when the desktop stopped posting the terminal
 * kinds in this same phase. TWO writers survive and neither is the session
 * window: `main/trigger-outcomes.js` posts `task_failed{declined:true}` on a
 * consent DENY and `{interrupted:true}` on a mid-spawn death, and every
 * INSTALLED desktop keeps posting the full set until the floor rises
 * (INVARIANTS §13). ⚠ **ONE READER now, not two:** the Declined receipt in
 * `message-receipt.ts`. The muted activity dot lived in
 * `activity-event-row.tsx`, which was deleted with the two-pane page at the v2
 * cutover (2026-08-18).
 *
 * ⚠ STRICT `=== true`, NEVER TRUTHINESS. `metadata` is an unbounded `z.record`
 * on the wire, so a truthy-but-not-true value ("yes", 1, {}) is
 * caller-influenceable; letting one pass disguises a real failure as a calm
 * outcome. Status is decided by FLAG, never by matching body copy — matching
 * copy regresses the first time somebody improves the wording (INVARIANTS §5).
 */

import type { ChannelMessage } from "../types";

/**
 * The calm terminal states — endings that are NOT a failure and share the muted
 * (never alarm-red) treatment. `failed` is deliberately absent: the point of
 * this read is to tell a real failure from an operator-chosen stop.
 */
export type CalmTerminalStatus =
  | "declined"
  | "dropped"
  | "interrupted"
  | "capped"
  | "ended";

/**
 * Map a terminal marker to the calm status it announces, else null (a genuine
 * failure). The desktop encodes a non-failure ending as `task_failed` + a
 * boolean flag: `declined` (consent denied), `dropped` (send cancelled),
 * `interrupted` (app died mid-spawn), `capped` (turn/cost cap), `ended`
 * (operator ended the agent).
 *
 * ⚠ ORDER IS PRECEDENCE, and it runs request-level first: `declined` and
 * `dropped` say the work never RAN, which outranks a statement about how a run
 * stopped. Both callers depend on it — the receipt reports "Declined" rather
 * than a downstream flag on the same row.
 */
export function calmTerminalStatus(
  message: ChannelMessage
): CalmTerminalStatus | null {
  if (message.kind !== "task_failed") return null;
  const { metadata } = message;
  if (metadata.declined === true) return "declined";
  if (metadata.dropped === true) return "dropped";
  if (metadata.interrupted === true) return "interrupted";
  if (metadata.capped === true) return "capped";
  if (metadata.ended === true) return "ended";
  return null;
}

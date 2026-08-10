/**
 * Thread grouping — THE READ SIDE.
 *
 * Everything the session card asks of a session AFTER `groupThread` has built
 * it: which lane an entry renders in, whether a terminal marker's body is
 * content, what the live close proposal is, how a header line is trimmed.
 *
 * Split out of `group-thread.ts` (§2, 819 lines) on the seam §2 asks for — one
 * file per reason to change. These functions change when the CARD changes; the
 * state machine changes when the transcript's shape does. Nothing here reads or
 * writes a `Draft`, and nothing here is called during the grouping pass except
 * the two helpers `computeSummary` borrows.
 */

import type { ChannelMessage } from "../types";
import type { CloseProposal } from "./group-thread-types";
import {
  calmTerminalStatus,
  isSessionEndedMarker,
  isThreadReopenedMarker,
} from "./group-thread-markers";

/** Collapse whitespace and cap length with an ellipsis (header previews). */
export function truncateSummary(text: string, max = 120): string {
  const clean = text.replace(/\s+/g, " ").trim();
  if (clean.length <= max) return clean;
  return `${clean.slice(0, max - 1).trimEnd()}…`;
}

/**
 * The LATEST close proposal in a session, or null. Latest rather than first: a
 * long exchange can be proposed on, continue, and be proposed on again, and the
 * live prompt is the most recent one.
 */
export function readCloseProposal(session: {
  entries: ChannelMessage[];
}): CloseProposal | null {
  for (let i = session.entries.length - 1; i >= 0; i -= 1) {
    const message = session.entries[i];
    if (message.metadata.closeProposed !== true) continue;
    const outcome = message.metadata.closeOutcome;
    return {
      message,
      outcome: outcome === "failed" ? "failed" : "completed",
    };
  }
  return null;
}

/**
 * The bodies the RUNTIME and the close route generate for a terminal marker.
 *
 * Every one of them is boilerplate a card already says better with its status
 * chip ("Finished this request." under a Done chip is noise). Anything NOT in
 * this set is somebody's own words, and {@link substantiveEndBody} is what makes
 * the difference renderable.
 *
 * Enumerated rather than guessed at by length, because the guess fails in both
 * directions: "Task failed" is short and generated, and a one-line human close
 * summary is short and real. The sources are `channel-post.postTaskEvent`'s
 * `bodies` map, `session-window.onEnded`'s derived bodies, `session-effects`'
 * `endLifecycle`, and `service-tasks.closeTask`'s default echo — the four places
 * that write a terminal marker at all.
 */
const GENERATED_TERMINAL_BODIES: ReadonlySet<string> = new Set([
  "Finished this request.",
  "Could not complete this request.",
  "Request interrupted",
  "Request declined",
  "Limit reached",
  "Session ended",
  "Turn limit reached",
  "Cost limit reached",
  "Task completed",
  "Task failed",
]);

/**
 * A terminal marker's body when it carries CONTENT, else null.
 *
 * P0-4 (2026-08-04) — THE STRUCTURAL HALF OF THE VANISHING ANSWER. A
 * `task_finished` / `task_failed` sets `draft.endEvent` and is never pushed to
 * `draft.entries`, so its body has no render path AT ALL: an agent that posted
 * its whole answer as `task_finished` had that answer stored, delivered, and
 * shown nowhere. `service-writes` now refuses that post from an agent, which
 * stops NEW ones — but rows like it already exist in the transcript, the desktop
 * runtime legitimately posts a `bodyOverride` on some ends, and a human's close
 * summary rides out as the echo's body. All three are content, and content the
 * renderer drops is the bug class this whole round is about.
 *
 * So the rule is about the BODY, not about who wrote it: if a terminal marker
 * says something the generators do not, show it.
 */
export function substantiveEndBody(message: ChannelMessage): string | null {
  // A CALM-FLAGGED marker is STATUS, never content, whatever its body says. The
  // desktop writes those flags for an outcome the operator chose (declined,
  // dropped, interrupted, capped, ended) and the card already renders each as a
  // one-line calm note off the flag — so its body ("Reply not sent", "Request
  // interrupted", whatever a later build words it as) is a second copy of the
  // chip, and promoting it to the reply lane would put a status line where a
  // deliverable goes. Checked FIRST and by FLAG rather than by string, so the
  // rule holds for wordings nobody has written yet.
  if (calmTerminalStatus(message) !== null) return null;
  const body = message.body.trim();
  if (!body || GENERATED_TERMINAL_BODIES.has(body)) return null;
  return body;
}

/** The three render lanes a session's entries fall into. */
export interface SessionLanes {
  /** `task_progress` accomplishments — the live work log, check-marked. */
  milestones: ChannelMessage[];
  /** Chat replies (plus a terminal marker that carried real content). */
  replies: ChannelMessage[];
  /**
   * STATUS lines about the thread itself, not about the work: the
   * server-stamped reopen echo and the `session_ended` marker (F-183).
   * Rendered as a calm one-liner — never a ✓, never a deliverable. See
   * {@link splitSessionEntries}.
   */
  notices: ChannelMessage[];
}

/**
 * Split a session's body entries into the render lanes the card shows
 * separately. All three preserve the input seq order. This is a pure
 * RENDER-layer split — `groupThread` deliberately keeps `task_progress` inside
 * `SessionGroup.entries` (its output is byte-for-byte unchanged), and the card
 * separates the lanes only at render time.
 *
 * P0-4: a TERMINAL marker that reached `entries` (it got there only by carrying
 * a substantive body — see {@link substantiveEndBody}) joins the REPLIES lane.
 * It has to land in one of the lanes or the belt does nothing: this function is
 * what the card actually renders from, and an entry in no lane is invisible
 * exactly the way `endEvent` was. Replies rather than milestones because that is
 * what it is — somebody's words, not a checklist tick.
 *
 * F-176 (2026-08-08) — AND A STATUS MARKER IS NOT A MILESTONE. `task_progress`
 * was two things at once here: an agent's accomplishment log, and the carrier
 * for reserved server-stamped markers that must never be terminal. The lane
 * split treated the second as the first, so the REOPEN echo — the message whose
 * whole content is "this settled exchange is live again" — rendered under a
 * heading called "Milestones" with a green ✓ beside it. On a thread that had
 * just come back from closed, the one glyph on screen said "done".
 *
 * The `notices` lane is that distinction made structural, and it is drawn by
 * FLAG BEFORE STRING like every other status/content line in this module
 * ({@link substantiveEndBody} draws the same one for terminal bodies): the echo's
 * copy is server-generated and already has two forms, so a renderer that matched
 * on its wording would regress to the ✓ the first time the copy improved. An
 * ordinary agent milestone carries no reserved marker and is untouched.
 */
export function splitSessionEntries(entries: ChannelMessage[]): SessionLanes {
  const milestones: ChannelMessage[] = [];
  const replies: ChannelMessage[] = [];
  const notices: ChannelMessage[] = [];
  for (const entry of entries) {
    if (entry.kind === "task_progress") {
      // F-183: BOTH reserved markers are status, not accomplishments. The
      // `session_ended` marker additionally drives `calmEndStatus` — that is
      // CURRENT STATE (cleared by a later restart), while this lane entry is
      // chronological HISTORY; they are different jobs, so the marker moves
      // lanes here and the state note stays.
      if (isThreadReopenedMarker(entry) || isSessionEndedMarker(entry)) {
        notices.push(entry);
      } else milestones.push(entry);
    } else if (entry.kind === "message") replies.push(entry);
    else if (entry.kind === "task_finished" || entry.kind === "task_failed") {
      replies.push(entry);
    }
  }
  return { milestones, replies, notices };
}

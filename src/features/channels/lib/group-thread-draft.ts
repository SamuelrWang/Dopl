/**
 * Thread grouping — THE DRAFT, AND WHAT A FINISHED ONE MEANS.
 *
 * `groupThread` accumulates a {@link Draft} per session as it walks the
 * transcript; these two functions read a COMPLETE draft and answer the header's
 * questions — what state is this exchange in, and what one line describes it.
 *
 * Split out of `group-thread.ts` (§2, 819 lines). The seam is real rather than
 * arithmetic: `computeStatus` / `computeSummary` are pure functions OF a draft
 * and touch neither the message walk, the fallback window, nor the pair-join.
 * They change when the card's precedence rules change (and both have, twice —
 * see the P0-4 note below); the walk changes when the transcript's shape does.
 * The accumulator itself travels with them because they are its only readers
 * besides the finalize loop.
 */

import type { ChannelMessage } from "../types";
import type { SessionStatus } from "./group-thread-types";
import { calmTerminalStatus } from "./group-thread-markers";
import { substantiveEndBody, truncateSummary } from "./group-thread-render";

/** Mutable accumulator; finalized into a `SessionGroup` at the end. */
export interface Draft {
  taskId: string;
  head: ChannelMessage;
  entries: ChannelMessage[];
  startedEvent: ChannelMessage | null;
  endEvent: ChannelMessage | null;
  createdAt: string;
  /**
   * The responder — the `task_started` author (the operator whose agent runs
   * the task). Anchors the {requester, responder} pair for the pair-join.
   */
  responder: string | null;
  /**
   * The requester — the human who opened the exchange: the author of the legacy
   * seq-N message addressed to the responder. Set when the `task_started` fires
   * (from the seq-N opener), or during the seq-N backfill. Drives the pair-join.
   */
  requester: string | null;
  /** The `N` in a legacy `task-{channelId}-{N}` id, for the seq-N backfill. */
  legacySeq: number | null;
  /**
   * P1-7 — the latest NON-TERMINAL session-end marker (`task_progress` +
   * `session_ended`). Deliberately NOT `endEvent`: it must never become the
   * exchange's outcome. It only feeds `SessionGroup.calmEndStatus`, so the card
   * can stop saying "Working…" for a session that stopped without claiming the
   * shared thread ended.
   */
  sessionEndedEvent: ChannelMessage | null;
}

/** A non-empty string `metadata.summary`, or null. */
function readSummary(metadata: Record<string, unknown>): string | null {
  const value = metadata.summary;
  return typeof value === "string" && value.length > 0 ? value : null;
}

export function computeStatus(draft: Draft): SessionStatus {
  // Precedence, most authoritative first:
  // 1. An explicit terminal marker always wins. A `task_failed` is a genuine
  //    failure UNLESS it carries an operator-chosen calm-terminal flag
  //    (declined/dropped/interrupted), in which case it takes that calm state.
  if (draft.endEvent) {
    if (draft.endEvent.kind === "task_failed") {
      return calmTerminalStatus(draft.endEvent) ?? "failed";
    }
    return "done";
  }
  // 2. A delivered AGENT reply implies the work completed, even with no
  //    `task_finished` — a terminal-mode session self-posts its reply and then
  //    falls silent, and a dropped finish still leaves a real answer on screen.
  //    Either way the session is Done, not a perpetual "Active" pulse. Only an
  //    agent reply counts: a session can now also carry the requester's own
  //    (human) messages (seq-N backfill / pair-join), which must not, on their
  //    own, mark an unanswered started task as Done.
  if (draft.entries.some((e) => e.kind === "message" && e.authorKind === "agent"))
    return "done";
  // 3. Started, but nothing delivered yet — genuinely in flight.
  if (draft.startedEvent) return "active";
  // 4. No markers and no reply (only stray progress lines): nothing is live.
  return "done";
}

export function computeSummary(draft: Draft): string | null {
  // 1. An explicit `metadata.summary`, read OUTCOME-FIRST.
  //
  // P0-4: this used to scan `[startedEvent, endEvent, ...entries]`, so the
  // START's summary won — and a `task_started`'s summary is the requester's
  // ORIGINAL ASK, stamped by the server when the thread opened. The header
  // therefore described the question for the whole life of the card, including
  // after it was answered, which is how "a well-behaved agent that writes a good
  // summary hides its own answer" became literally true. The header should say
  // how the exchange stands, so the end and the entries are read first and the
  // opening ask is the last resort.
  //
  // AND THE END SPEAKS BEFORE ANY OTHER EVENT'S SUMMARY, by its summary and then
  // by its body. This is the half the diagnosis named exactly: a summary-first
  // scan means "a well-behaved agent that writes a good summary hides its own
  // answer harder than a sloppy one", because the ANSWER lives in a body while
  // the ASK lives in a summary one event earlier. On a first-class thread the
  // requester's own opening request is itself an ENTRY (it carries the thread
  // tag) with the ask as its summary, so simply reordering the event list is not
  // enough — the end's own words have to outrank an earlier event's summary.
  const end = draft.endEvent;
  if (end) {
    const endSummary = readSummary(end.metadata);
    if (endSummary) return truncateSummary(endSummary);
    const endBody = substantiveEndBody(end);
    if (endBody) return truncateSummary(endBody);
  }
  // 2. Then any explicit `metadata.summary`, entries NEWEST-FIRST (the most
  //    recent statement of intent), and the opening ask only as a last resort.
  for (const event of [...[...draft.entries].reverse(), draft.startedEvent]) {
    if (!event) continue;
    const summary = readSummary(event.metadata);
    if (summary) return truncateSummary(summary);
  }
  // 3. The last agent reply's text, truncated.
  const replies = draft.entries.filter((e) => e.kind === "message");
  const lastReply = replies[replies.length - 1];
  if (lastReply && lastReply.body.trim()) return truncateSummary(lastReply.body);
  // 4. Fall back to the task event's human-readable body.
  const taskEvent = draft.startedEvent ?? draft.endEvent;
  if (taskEvent && taskEvent.body.trim()) return truncateSummary(taskEvent.body);
  return null;
}

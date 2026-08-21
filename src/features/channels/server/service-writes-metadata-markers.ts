import "server-only";

/**
 * THE RESERVED MARKER KEYS — metadata that changes how a THREAD CARD READS, and
 * which therefore may NEVER arrive from the wire. (`service-writes-metadata.ts`
 * answers what the stored metadata is; `service-writes-metadata-thread.ts`
 * answers who may write into a thread; this file answers which keys are the
 * server's own voice.)
 *
 * ⚠ ONE RULE FOR EVERY KEY HERE: stripped from caller metadata UNCONDITIONALLY
 * and re-stamped only from a server-validated value, only onto a post carrying a
 * thread tag the poster is entitled to. A member who could set one could narrate
 * somebody ELSE'S exchange (declined, finished, proposed-for-close, reopened)
 * without touching the work it describes.
 *
 * ⚠ `channel_messages.kind` carries a CHECK constraint, so each marker buys a
 * distinction that would otherwise cost a migration deployed ahead of every
 * writer. That is why this list grows instead of the kind enum.
 */

/**
 * Calm-terminal flags a `task_failed` may carry (`declined`, `dropped`,
 * `interrupted`, `capped`, `ended` — read by `lib/calm-terminal.ts ›
 * calmTerminalStatus`, which is where they moved when the `group-thread*` family
 * was deleted, wiring plan Phase 5, 2026-08-18). They decide
 * whether the other side's card reads calm or red, and the message receipt shows
 * Declined / Interrupted off the same bits. ⚠ Reserved: a member able to set
 * them on someone else's thread could fabricate that thread's outcome.
 *
 * ⚠ THESE SURVIVED PHASE 4 (2026-08-18) WHILE THE CLOSE MARKERS DID NOT, and the
 * difference is what they describe. A calm flag is about ONE MEMBER'S SESSION
 * ending — `declined` is still written by the consent DENY echo in the desktop's
 * `trigger.js`, `session_ended` by the operator End — and a session ending is not
 * an outcome for the shared thread. `closeProposed` / `closeOutcome` /
 * `threadReopened` described a thread SETTLEMENT, which no longer exists.
 */
const CALM_FLAG_KEYS = [
  "declined",
  "dropped",
  "interrupted",
  "capped",
  "ended",
  // ⚠ NON-TERMINAL session end: `session_ended` rides a `task_progress`, NOT a
  // `task_failed`. Reserved on the same terms as its five siblings — it changes
  // how the other member's card reads ("their session stopped", not "the thread
  // failed"). ⚠ NOT read by `calmTerminalStatus` (which answers only for a
  // `task_failed`), and that is the point: a local session ending is not an
  // outcome for the shared thread.
  "session_ended",
] as const;

export type CalmFlagKey = (typeof CALM_FLAG_KEYS)[number];

/**
 * Strip every calm-terminal flag from caller metadata and report which were
 * asked for. ⚠ Only a literal `true` counts — a truthy-but-not-true value
 * (`"yes"`, `1`) is dropped and never re-stamped, so the wire only ever carries
 * the strict booleans the renderers read.
 */
export function takeCalmFlags(
  metadata: Record<string, unknown>
): CalmFlagKey[] {
  const requested: CalmFlagKey[] = [];
  for (const key of CALM_FLAG_KEYS) {
    if (metadata[key] === true) requested.push(key);
    delete metadata[key];
  }
  return requested;
}

/**
 * ⚠ TWO MARKER SETS ENDED HERE with thread closing (wiring plan Phase 4,
 * 2026-08-18), and they LEFT the reserved list rather than staying in it with no
 * writer:
 *
 *  - `CLOSE_PROPOSAL_KEYS` = `closeProposed` / `closeOutcome`, stamped by the
 *    deleted `service-tasks-propose.ts › proposeTaskClose` and by the deleted
 *    stale-threads cron. They raised a "Close?" prompt on a human's card.
 *  - `REOPEN_MARKER_KEY` = `threadReopened`, stamped by the deleted
 *    `service-tasks-lifecycle.ts › reopenTask` as the echo that rang the
 *    `channel_messages` doorbell for a status change `channel_tasks` (in no
 *    realtime table set) could not deliver itself.
 *
 * ⚠ WHY THESE LEAVE AND {@link CALM_FLAG_KEYS} STAYS. The strip list exists to
 * keep a key UNFORGEABLE for as long as anything RENDERS it — that is why the
 * dead agent-attribution keys are still stripped with no writer left (stored rows
 * still render them, INVARIANTS §5). Nothing renders a close prompt or a reopen
 * notice any more: the prompt component, `readCloseProposal` and
 * `isThreadReopenedMarker` are all deleted in the same change. A key nobody reads
 * is not a forgery surface. **If a reader ever comes back, the key comes back
 * here FIRST.**
 */

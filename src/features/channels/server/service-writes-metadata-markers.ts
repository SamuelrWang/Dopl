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
 * `interrupted`, `capped`, `ended` — see `lib/group-thread.ts`). They decide
 * whether the other side's card reads calm or red, and the message receipt shows
 * Declined / Interrupted off the same bits. ⚠ Reserved: a member able to set
 * them on someone else's thread could fabricate that thread's outcome.
 */
export const CALM_FLAG_KEYS = [
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
 * Keys a CLOSE PROPOSAL stamps. ⚠ Reserved on the same terms as `runtime` /
 * `session_id` — a caller able to set them could raise a "Close?" prompt on a
 * thread it is not a party to, in front of a human whose one click settles the
 * exchange for both members.
 *
 * Two keys because the prompt prefills the proposed outcome: `closeProposed` is
 * what the surfaces match on, `closeOutcome` is what the confirm hands straight
 * back to `closeTask`.
 */
export const CLOSE_PROPOSAL_KEYS = ["closeProposed", "closeOutcome"] as const;

/**
 * The key a REOPEN ECHO stamps.
 *
 * ⚠ Why an echo exists: `channel_tasks` is in NEITHER realtime table set
 * (`constants.ts` `CHANNEL_TABLES`, `main/ui-sync.js` `SYNC_TABLES`). A close
 * gets away with it only because it POSTS — the terminal marker rings the
 * `channel_messages` doorbell and peers refetch the thread row behind it.
 * Without an echo, the peer's ThreadPanel row, card chip and sidebar dot read
 * "closed" until an unrelated message lands. ⚠ The fix is the echo, NOT adding
 * `channel_tasks` to the publication — `channel_messages` is already subscribed.
 *
 * ⚠ Its OWN key, never a reused one: a reopen is not a close, not a proposal and
 * not a session ending, and conflating them makes a close → reopen → close
 * transcript read as two closes with a stray line between.
 *
 * ⚠ Reserved, and the sharpest case of the rule: the marker's whole job is to
 * say "this settled exchange is live again", so a member who could stamp it in
 * raw metadata could reopen somebody else's thread ON SCREEN without the row
 * changing. `reopenTask` checks creator-or-target before asking for the stamp,
 * and the stamp lands only onto a surviving thread tag on top of that.
 *
 * ONE key, not two. A reopen prompts nothing and settles nothing, so there is no
 * value for a follow-up to read. The outcome it UNDID is nulled off the row, so
 * it is preserved in the echo's BODY where the transcript can show it.
 */
export const REOPEN_MARKER_KEY = "threadReopened";

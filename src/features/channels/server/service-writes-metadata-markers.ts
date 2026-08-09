import "server-only";

/**
 * THE RESERVED MARKER KEYS — the metadata that changes how a THREAD CARD READS,
 * and which therefore may never arrive from the wire.
 *
 * Split out of `service-writes-metadata.ts` at the §2 500-line cap when the
 * REOPEN marker landed (C-26, 2026-08-08), and on the seam the file had already
 * drawn twice in prose: `service-writes-metadata.ts` answers *what the stored
 * metadata is*, `service-writes-metadata-thread.ts` answers *who may write into
 * a thread*, and this file answers *which keys are the server's own voice*.
 *
 * They share one rule, stated once here instead of three times there: each key
 * below is stripped from caller metadata UNCONDITIONALLY and re-stamped only
 * from a server-validated value, and only onto a post carrying a thread tag the
 * poster is entitled to. The reason is the same for every one of them — a member
 * who could set one could narrate somebody ELSE'S exchange (declined, finished,
 * proposed-for-close, reopened) without touching the work it describes.
 *
 * `channel_messages.kind` carries a CHECK constraint, so every marker here buys
 * a distinction that would otherwise cost a schema migration deployed ahead of
 * every client that writes it. That is the recurring trade and it is why this
 * list grows instead of the kind enum.
 */

/**
 * The calm-terminal flags a `task_failed` may carry (`declined`, `dropped`,
 * `interrupted`, `capped`, `ended` — see `lib/group-thread.ts`). They decide
 * whether the other side's card reads as a calm, operator-chosen ending or a
 * red failure, and the message receipt shows Declined / Interrupted off the
 * same bits. Reserved, because a member who could set them on someone else's
 * thread could fabricate that thread's outcome ("This request was declined.")
 * without ever touching the session it describes.
 */
export const CALM_FLAG_KEYS = [
  "declined",
  "dropped",
  "interrupted",
  "capped",
  "ended",
  // P1-7 (2026-08-04) — THE NON-TERMINAL SESSION END. `session_ended` rides on a
  // `task_progress`, not a `task_failed`, and it is reserved on exactly the same
  // terms as its five siblings: it changes how the other member's card READS
  // ("their session stopped", not "the thread failed"), so a member who could
  // set it on somebody else's thread could narrate that thread's state without
  // touching the session it describes. It is NOT read by `calmTerminalStatus` —
  // that function answers only for a `task_failed` — which is the point: a local
  // session ending is not an outcome for the shared thread at all.
  "session_ended",
] as const;

export type CalmFlagKey = (typeof CALM_FLAG_KEYS)[number];

/**
 * Strip every calm-terminal flag from caller metadata and report which ones
 * were asked for. Only a literal `true` counts — a truthy-but-not-true value
 * (`"yes"`, `1`) is dropped and never re-stamped, so the wire can only ever
 * carry the strict booleans the renderers read (`=== true`).
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
 * The keys a CLOSE PROPOSAL stamps (DECISION 2, 2026-08-04). Reserved on the
 * same terms as `runtime` / `session_id`: stripped from caller metadata
 * unconditionally and re-stamped ONLY from a server-internal value, because a
 * caller that could set them would be able to raise a "your agent thinks this
 * can be closed — Close?" prompt on a thread it is not a party to, in front of a
 * human whose one click then settles the exchange for both members.
 *
 * Two keys rather than one because the prompt has to prefill the outcome the
 * agent is proposing: `closeProposed` is the marker the surfaces match on, and
 * `closeOutcome` is what the confirm hands straight back to `closeTask`.
 */
export const CLOSE_PROPOSAL_KEYS = ["closeProposed", "closeOutcome"] as const;

/**
 * The key a REOPEN ECHO stamps (C-26, 2026-08-08).
 *
 * WHY THERE IS AN ECHO AT ALL. `channel_tasks` is in NEITHER realtime table set
 * (`constants.ts` `CHANNEL_TABLES`, `main/ui-sync.js` `SYNC_TABLES`), and closing
 * got away with that only because a close POSTS — the `task_finished` /
 * `task_failed` marker rings the `channel_messages` doorbell and every peer
 * surface refetches the thread row behind it. Reopen posted nothing, so the other
 * member's ThreadPanel row, session card chip and sidebar dot went on reading
 * "closed" until an unrelated message happened to land in that channel. **Samuel's
 * decision (2026-08-08) was to give reopen the echo rather than add `channel_tasks`
 * to the publication**: the publication had just been trimmed 24 -> 17 tables on
 * cost grounds (two migrations on 2026-08-07) and `channel_messages` is already
 * subscribed, so the existing doorbell carries the news for free.
 *
 * WHY IT IS ITS OWN KEY AND NOT A REUSED ONE. A reopen is not a close, not a
 * proposal and not a session ending; conflating it with any of them would make
 * the transcript of a close -> reopen -> close read as two closes with a stray
 * line between them. One boolean marker, distinct from all of the above, is what
 * lets a renderer draw the resumption for what it is.
 *
 * WHY IT IS RESERVED. Same rule as its siblings, and the sharpest case of it: the
 * marker's whole job is to say "this settled exchange is live again". A member who
 * could stamp it in raw metadata could reopen somebody else's thread ON SCREEN
 * without the row ever changing — the peer would see a live thread the server
 * still considers closed, which is worse than the staleness this echo exists to
 * fix. `reopenTask` has already checked creator-or-target before it asks for the
 * stamp, and the stamp lands only onto a surviving thread tag on top of that.
 *
 * ONE KEY, not two. The close proposal needs a second (`closeOutcome`) because a
 * human's confirm click prefills from it; a reopen prompts nothing and settles
 * nothing, so there is no value for a follow-up action to read. The outcome the
 * reopen UNDID is nulled off the row by the reopen itself, so it is preserved in
 * the echo's BODY — human-readable, where the transcript can show it — rather
 * than in a second machine-read key nothing would consume.
 */
export const REOPEN_MARKER_KEY = "threadReopened";

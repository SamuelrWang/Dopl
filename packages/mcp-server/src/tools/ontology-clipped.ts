/**
 * THE CLIPPED-ONTOLOGY-READ NOTICE — worded once, for the four reads that can
 * see the clip.
 *
 * `ONTOLOGY_READ_LIMITS` (src/features/ontology/server/dto.ts) caps EVERY
 * whole-workspace ontology read — 500 clusters, 5 000 objects, 20 000
 * memberships — and a read that comes back AT its ceiling counts as clipped,
 * because at is indistinguishable from over. Only the SUMMARY projection
 * reports it: `getSummary` returns `truncated`, while `getSnapshot` carries the
 * identical ceilings and says nothing. So the reads that moved onto
 * `view: "summary"` did not become clippable — they always were — they became
 * the only reads in this lane ABLE to admit it, which is why every one of them
 * must, and in one wording.
 *
 * WHAT THE NOTICE MAY NOT PROMISE. `dopl_map`'s first version pointed a clipped
 * reader at `op="resolve"` and `op="get"`, which is true of the two levels
 * `dopl_map` renders and false of the clip itself: `op="resolve"` reads the same
 * projection under the same ceiling, and `op="get"` resolves its ref out of a
 * full snapshot capped at the same 5 000 rows. There is NO read on this
 * connection that reaches past the ceiling, so the notice says so and tells the
 * agent to report the gap instead of routing it in a circle.
 *
 * The caller supplies only the middle clause — what, on ITS surface, is a
 * prefix — because that is the one thing that genuinely differs between a
 * manifest, a two-level map and a query. The framing and the remedy are shared,
 * so a reader who has met one of these has met all four.
 */

/** The clipped-read line for one surface. `subject` completes "…, so ${subject}." */
export function clippedNote(subject: string): string {
  return `_CLIPPED — this workspace holds more ontology than one read returns, so ${subject}. Every ontology read here shares that row ceiling (op="map", op="resolve" and op="get" alike), so no read on this connection fills the gap: report it rather than presenting this as the whole graph._`;
}

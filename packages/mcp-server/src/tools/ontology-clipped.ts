/**
 * THE CLIPPED-ONTOLOGY-READ NOTICE — ⚠ worded ONCE, for every read that can see
 * the clip.
 *
 * `ONTOLOGY_READ_LIMITS` (src/features/ontology/server/dto.ts) caps EVERY
 * whole-workspace ontology read, and a read returning AT its ceiling counts as
 * clipped (at is indistinguishable from over). ⚠ Only the SUMMARY projection
 * REPORTS it — `getSummary` returns `truncated` while `getSnapshot` carries the
 * identical ceilings silently — so the summary-backed reads are the only ones
 * ABLE to admit it, and every one of them must.
 *
 * ⚠ THE NOTICE MAY NOT POINT AT `op="resolve"` OR `op="get"`: resolve reads the
 * same projection under the same ceiling, and get resolves its ref out of a
 * full snapshot capped at the same rows. NO read on this connection reaches
 * past the ceiling, so the notice says so and tells the agent to report the gap
 * rather than routing it in a circle.
 *
 * The caller supplies only the middle clause — what is a prefix on ITS surface.
 * Framing and remedy are shared, so a reader who met one has met all.
 */

/** The clipped-read line for one surface. `subject` completes "…, so ${subject}." */
export function clippedNote(subject: string): string {
  return `_CLIPPED — this workspace holds more ontology than one read returns, so ${subject}. Every ontology read here shares that row ceiling (op="map", op="resolve" and op="get" alike), so no read on this connection fills the gap: report it rather than presenting this as the whole graph._`;
}

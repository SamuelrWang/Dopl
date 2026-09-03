import "server-only";
import { SESSION_PROJECTION_FRESH_MS } from "../constants";

/**
 * **IS THIS SESSION-PROJECTION ROW RECENT ENOUGH TO ACT ON** — one rule, two
 * readers (`service-wake-verdict.ts` and its resilience arms).
 *
 * ⚠ **ITS OWN FILE (§1) ONLY BECAUSE BOTH SIDES OF THE 2026-09-02 SPLIT NEED
 * IT.** A copy in each would be two freshness windows wearing one name, which is
 * the F-266 shape this whole family avoids.
 *
 * ⚠ **THE RULE IS ASYMMETRIC AND THAT IS THE POINT (F-418).**
 * `channel_sessions` is a PROJECTION the desktop pushes on state change, so a
 * quiet row means nobody said anything, not that nothing is running. A fresh row
 * is evidence enough to RESOLVE; a stale one is NOT evidence of ABSENCE.
 *
 * ⚠ AN UNPARSEABLE STAMP IS STALE, not fresh — the fail-safe direction for a
 * window that licenses a refusal elsewhere (`service-directions.ts`).
 */
export function isFresh(updatedAt: string | null, now: number): boolean {
  const at = updatedAt ? Date.parse(updatedAt) : NaN;
  if (Number.isNaN(at)) return false;
  return now - at < SESSION_PROJECTION_FRESH_MS;
}

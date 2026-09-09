import type { Revision, RevisionDay } from "../types";

/**
 * Newest day first, newest row first within the day.
 *
 * ⚠ **ONE IMPLEMENTATION, IN `lib/` RATHER THAN IN THE SERVICE, BECAUSE BOTH
 * SIDES GROUP.** The server exports it (`server/service.ts` re-exports this
 * name) and the renderer calls it over every page loaded so far — a page
 * boundary falls wherever the keyset put it, so grouping per page would render
 * one calendar day as two headed groups. A mirrored copy in `client/` would be a
 * second statement of the same arithmetic and is exactly what this file exists
 * to prevent.
 *
 * ⚠ **THE DAY KEY IS UTC, AND THAT IS A DECISION.** The server has no honest
 * access to the reader's zone, and a key computed in one zone and rendered in
 * another produces a "Yesterday" heading over rows stamped today. So the
 * grouping is stated in UTC, once, and the renderer LABELS the key rather than
 * re-deriving it from the row stamps. It is also what makes the grouping immune
 * to DST: a UTC day is 24 hours on every day of the year, so no group is 23 or
 * 25 hours long and no row lands in two of them.
 *
 * ⚠ PURE. No clock, no locale, no I/O — the same input answers the same groups
 * on every machine.
 *
 * ⚠ IT DOES NOT SORT. The rows arrive newest-first from a keyset read, and
 * re-sorting here would hide a repository that stopped ordering.
 */
export function groupByDay(revisions: readonly Revision[]): RevisionDay[] {
  const days: RevisionDay[] = [];
  const byDay = new Map<string, RevisionDay>();
  for (const revision of revisions) {
    const day = new Date(revision.createdAt).toISOString().slice(0, 10);
    let group = byDay.get(day);
    if (!group) {
      group = { day, revisions: [] };
      byDay.set(day, group);
      days.push(group);
    }
    group.revisions.push(revision);
  }
  return days;
}

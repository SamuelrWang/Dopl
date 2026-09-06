import { describe, expect, it } from "vitest";
import {
  bucketByLocalDay,
  localDayKey,
  windowDays,
} from "./overview-token-spend";

/**
 * TOKEN SPEND — **THE DAY BOUNDARY**, pinned at the pure seam (Samuel's ruling,
 * 2026-09-06: the strip buckets by LOCAL day).
 *
 * ⚠ **THE EXPECTATIONS ARE COMPUTED A DIFFERENT WAY ON PURPOSE.** The code under
 * test reads `getFullYear`/`getMonth`/`getDate`; this file asks
 * `Intl.DateTimeFormat("en-CA")` — which resolves to the same zone through a
 * completely separate mechanism — so the assertions are a cross-check rather
 * than the implementation restated. Re-deriving the key with the same getters
 * would pass on a `toISOString()` regression too.
 *
 * ⚠ **AND THE INSTANTS ARE BUILT FROM LOCAL WALL TIME**, so the cases have teeth
 * in any zone with an offset: `new Date(y, m, d, 0, 30)` is 00:30 THIS morning
 * wherever the suite runs, and its UTC date is a different day for roughly half
 * the planet. A strip that went back to slicing the ISO string puts it in the
 * wrong column there and this suite says so.
 */

/** The local calendar day, via `Intl` — the independent second opinion. */
const expected = (at: Date) =>
  new Intl.DateTimeFormat("en-CA", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(at);

/** A local wall-clock instant, as the wire carries it. */
function atLocal(daysAgo: number, hour: number, minute = 0): Date {
  const now = new Date();
  return new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate() - daysAgo,
    hour,
    minute
  );
}

const mark = (at: Date, tokens: number) => ({ at: at.toISOString(), tokens });

describe("localDayKey", () => {
  it("names the operator's calendar day, not the UTC one", () => {
    const earlyToday = atLocal(0, 0, 30);
    const lateTonight = atLocal(0, 23, 30);
    expect(localDayKey(earlyToday)).toBe(expected(earlyToday));
    expect(localDayKey(lateTonight)).toBe(expected(lateTonight));
    // Both ends of one LOCAL day are one key, however the UTC dates fall.
    expect(localDayKey(earlyToday)).toBe(localDayKey(lateTonight));
  });
});

describe("windowDays", () => {
  it("is 31 contiguous local days ending today, oldest first", () => {
    const days = windowDays(31);
    expect(days).toHaveLength(31);
    expect(new Set(days).size).toBe(31);
    expect(days[30]).toBe(expected(new Date()));
    expect(days[0]).toBe(expected(atLocal(30, 12)));
    // Sorted, and `YYYY-MM-DD` sorts lexically — so this also catches a month
    // or year end walked wrong.
    expect([...days].sort()).toEqual(days);
  });
});

describe("bucketByLocalDay", () => {
  const days = windowDays(31);

  it("adds up the runs that share a local day", () => {
    const { byDay, total, runs } = bucketByLocalDay(
      [
        mark(atLocal(0, 0, 30), 30_000),
        mark(atLocal(0, 23, 30), 10_000),
        mark(atLocal(1, 12), 5_000),
      ],
      days
    );
    expect(byDay.get(expected(new Date()))).toBe(40_000);
    expect(byDay.get(expected(atLocal(1, 12)))).toBe(5_000);
    expect(total).toBe(45_000);
    expect(runs).toBe(3);
  });

  /**
   * ⚠ **THE HEADER MAY ONLY COUNT WHAT THE AXIS DRAWS.** The route hauls a
   * WIDER window than 31 local days so the oldest column is never short, so runs
   * off the front of the axis do arrive — and summing one into a total the strip
   * cannot show is the two-numbers-on-one-card defect this wave removed from the
   * credits bar.
   */
  it("drops a run that falls outside the drawn window, total and count included", () => {
    const { byDay, total, runs } = bucketByLocalDay(
      [mark(atLocal(0, 12), 20_000), mark(atLocal(40, 12), 90_000)],
      days
    );
    expect(byDay.size).toBe(1);
    expect(total).toBe(20_000);
    expect(runs).toBe(1);
  });

  /** ⚠ A persisted payload from an older bundle can carry a shape this build
   *  cannot read (§8); `NaN` would take the strip's whole scale with it. */
  it("drops an unparseable instant rather than bucketing it as today", () => {
    const { byDay, total, runs } = bucketByLocalDay(
      [{ at: "not-a-date", tokens: 10_000 }],
      days
    );
    expect(byDay.size).toBe(0);
    expect(total).toBe(0);
    expect(runs).toBe(0);
  });
});

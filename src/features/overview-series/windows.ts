/**
 * THE ONE OVERVIEW SERIES VOCABULARY — ranges, buckets, bins, zero-fill
 * (P33 / R-29(b), wave 8).
 *
 * 🔒 **ONE IMPLEMENTATION OF THE SERIES, TWO PAYLOADS — AND THE SPLIT IS THE
 * RULING (R-29(b), Samuel 2026-09-17: the SERIES first, and *not* (c) for the
 * payload).** /home's series is fenced on the reader's PERSONAL WALLET and a
 * workspace's on that container's SEAT wallets; those are different meters, and
 * summing across them was the exact 2026-09-12 bug
 * (`docs/specs/credit-model-v2.md` §3). So what is shared is this file — the
 * window arithmetic, the bucket, the zero-fill and the `truncated` story — and
 * what is NOT shared is the payload or the fence. **Never widen this module
 * with a read.** It does no IO and knows no container kind.
 *
 * ⚠ **THE RANGE UNION IS THE UNION OF BOTH HOSTS' SETS, AND NEITHER HOST
 * ACCEPTS ALL OF IT.** /home's allowed set is `overview-types.ts ›
 * HOME_OVERVIEW_RANGES` (four); a workspace's is
 * `workspaces/types.ts › WORKSPACE_SERIES_RANGES` (four, a different four). A
 * host parses its OWN set and 400s everything else — the fall-through ban in
 * INVARIANTS §9 is per host, not per union.
 *
 * ⚠ **NO `server-only`.** This is arithmetic over strings; the SPA imports the
 * types beside it, and a marker here would fence the renderer out of them.
 */

/**
 * Every window either host can ask for.
 *
 * ⚠ **`31d` IS THE WORKSPACE'S LEGACY FIXED WINDOW, NOT A SWITCHER OPTION** —
 * today plus the 30 UTC days before it, what
 * `…/overview-series` answered with no `range` at all before wave 8 and what
 * `channels/components/thread-activity.tsx › ThreadActivityStrip` still reads.
 * It stays reachable so that caller's window did not silently move by a day.
 */
export type OverviewSeriesRange = "24h" | "7d" | "30d" | "31d" | "month";

/** What one bin spans. `24h` bins by hour; every other range by UTC day. */
export type OverviewSeriesBucket = "hour" | "day";

/** `[startIso, endIso)` — one bin. */
export interface OverviewWindow {
  startIso: string;
  endIso: string;
}

const HOUR_MS = 3_600_000;
const DAY_MS = 86_400_000;

/**
 * Bins, and the width of one, for each window.
 *
 * ⚠ `month`'s `bins` IS COMPUTED, not stored — a month is 28..31 days.
 * {@link overviewWindows} overrides the number; it is here so the record stays
 * total over the union.
 */
const RANGE_SHAPE: Record<
  OverviewSeriesRange,
  { bins: number; bucket: OverviewSeriesBucket }
> = {
  "24h": { bins: 24, bucket: "hour" },
  "7d": { bins: 7, bucket: "day" },
  "30d": { bins: 30, bucket: "day" },
  "31d": { bins: 31, bucket: "day" },
  month: { bins: 31, bucket: "day" },
};

export function overviewBucketFor(
  range: OverviewSeriesRange
): OverviewSeriesBucket {
  return RANGE_SHAPE[range].bucket;
}

/** Truncate `at` down to the start of its UTC hour. */
function hourStart(at: Date): Date {
  return new Date(Math.floor(at.getTime() / HOUR_MS) * HOUR_MS);
}

/** Truncate `at` down to the start of its UTC day. */
function dayStart(at: Date): Date {
  return new Date(
    Date.UTC(at.getUTCFullYear(), at.getUTCMonth(), at.getUTCDate())
  );
}

/**
 * The bins for one range, oldest first.
 *
 * ⚠ THE LAST BIN OF A ROLLING RANGE IS PARTIAL AND THAT IS CORRECT — it is "so
 * far today" (or "this hour"). What would NOT be correct is extending a ROLLING
 * window into the future so the bar looks finished.
 *
 * 🔒 **`month` IS THE WHOLE CALENDAR MONTH — EVERY DAY OF IT, 28..31 BINS — AND
 * IT IS THE ONE RANGE THAT DOES REACH INTO THE FUTURE (Samuel, 2026-09-01:
 * "show the month").** It was MONTH-TO-DATE for one pass, `bins =
 * now.getUTCDate()`, which is **1 on the first of the month** — so the chart
 * rendered a SINGLE bar stretched across the whole plot. Month-to-date
 * reproduces that every month on the 1st.
 * ⚠ **THE FUTURE BINS ARE ZERO AND THAT IS THE POINT**: the axis is the FRAME
 * the operator reads the month against. A future day's zero is not a claim that
 * nothing happened — it is a day that has not happened, which the axis position
 * already says.
 *
 * ⚠ **MOVED HERE FROM `home/server/service-overview.ts` IN WAVE 8, UNCHANGED.**
 * That file re-exports it, so /home's windows are the same windows byte for
 * byte (R-40) and the workspace host cannot grow a second calendar.
 */
export function overviewWindows(
  range: OverviewSeriesRange,
  now: Date = new Date()
): OverviewWindow[] {
  const { bucket } = RANGE_SHAPE[range];
  const width = bucket === "hour" ? HOUR_MS : DAY_MS;

  if (range === "month") {
    const year = now.getUTCFullYear();
    const month = now.getUTCMonth();
    // Day 0 of the NEXT month is the last day of this one — 28/29/30/31 without
    // a leap-year table.
    const days = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
    const first = Date.UTC(year, month, 1);
    return Array.from({ length: days }, (_, index) => ({
      startIso: new Date(first + index * width).toISOString(),
      endIso: new Date(first + (index + 1) * width).toISOString(),
    }));
  }

  const last = bucket === "hour" ? hourStart(now) : dayStart(now);
  const bins = RANGE_SHAPE[range].bins;
  const windows: OverviewWindow[] = [];
  for (let i = bins - 1; i >= 0; i--) {
    const start = new Date(last.getTime() - i * width);
    windows.push({
      startIso: start.toISOString(),
      endIso: new Date(start.getTime() + width).toISOString(),
    });
  }
  return windows;
}

/** Where a range's window opens — the first bin's start, so a payload's totals
 *  and its bars describe the SAME window rather than two nearby ones. */
export function overviewSince(
  range: OverviewSeriesRange,
  now: Date = new Date()
): string {
  const windows = overviewWindows(range, now);
  return windows[0]?.startIso ?? now.toISOString();
}

/**
 * LEDGER ROWS → ONE ZERO-FILLED BIN EACH.
 *
 * ⚠ **BINNED BY A HALF-OPEN COMPARISON ON THE INSTANT**, not by arithmetic on a
 * day number: the bins are already `[start, end)` pairs and a row belongs to
 * exactly one of them. A row outside every bin (the scan can return one when the
 * window boundary moves between reads) is DROPPED rather than folded into the
 * nearest bar.
 *
 * ⚠ **ALWAYS THE FULL BIN COUNT, NEVER AN EMPTY ARRAY.** Samuel overruled the
 * honesty argument that an empty ledger should answer `[]` (2026-09-01): the
 * axis is the frame and the page never loses it.
 */
export function binByWindow<T>(
  rows: readonly T[],
  windows: readonly OverviewWindow[],
  at: (row: T) => string,
  amount: (row: T) => number
): number[] {
  const counts = windows.map(() => 0);
  const bounds = windows.map((win) => [
    Date.parse(win.startIso),
    Date.parse(win.endIso),
  ] as const);
  for (const row of rows) {
    const instant = Date.parse(at(row));
    for (let i = 0; i < bounds.length; i++) {
      const [start, end] = bounds[i];
      if (instant >= start && instant < end) {
        counts[i] += amount(row);
        break;
      }
    }
  }
  return counts;
}

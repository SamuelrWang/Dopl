/**
 * R-29(b) (2026-09-17): one implementation of the overview series, two payloads.
 * /home's series is fenced on the reader's personal wallet and a workspace's on
 * that container's seat wallets — different meters, and summing across them was
 * the 2026-09-12 bug. Shared here: the window arithmetic, the bucket, the
 * zero-fill, the `truncated` story. Not shared: the payload or the fence. Never
 * widen this module with a read — it does no IO and knows no container kind.
 *
 * The range union is both hosts' sets and neither host accepts all of it; each
 * parses its OWN set and 400s the rest (INVARIANTS §9 is per host, not per union).
 *
 * No `server-only`: this is arithmetic over strings, and the SPA imports the
 * types beside it.
 */

/**
 * Every window either host can ask for. `31d` is the workspace's legacy fixed
 * window, not a switcher option — today plus the 30 UTC days before it, still
 * read by `channels/components/thread-activity.tsx › ThreadActivityStrip`. It
 * stays reachable so that caller's window did not silently move by a day.
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
 * Bins, and the width of one, for each window. `month`'s `bins` is computed, not
 * stored (28..31 days); {@link overviewWindows} overrides the number, which is
 * here only so the record stays total over the union.
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
 * The last bin of a ROLLING range is partial and that is correct — "so far
 * today". Extending a rolling window into the future so the bar looks finished
 * would not be.
 *
 * (2026-09-01) `month` is the whole CALENDAR month, 28..31 bins, and is the one
 * range that reaches into the future. Month-to-date gives `bins = 1` on the first
 * of the month, which renders a single bar stretched across the plot. The future
 * bins are zero on purpose: the axis is the frame the month is read against.
 *
 * R-40: `home/server/service-overview.ts` re-exports this, so /home's windows are
 * the same windows byte for byte and the workspace host cannot grow a second
 * calendar.
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
    // Day 0 of the next month is the last day of this one — 28/29/30/31 without
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
 * Ledger rows to one zero-filled bin each.
 *
 * Binned by a half-open comparison on the instant, not arithmetic on a day
 * number: the bins are already `[start, end)` pairs. A row outside every bin (the
 * scan can return one when the window boundary moves between reads) is dropped
 * rather than folded into the nearest bar.
 *
 * (2026-09-01) Always the full bin count, never an empty array: the axis is the
 * frame and the page never loses it.
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

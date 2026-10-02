/**
 * R-29(b) (2026-09-17): one overview-series implementation, two payloads. /home
 * fences on the personal wallet, a workspace on its seat wallets — summing across
 * them was the 2026-09-12 bug. Shared: window arithmetic, bucket, zero-fill.
 * Never add a read here — no IO, no container kind.
 *
 * Each host parses its OWN range set and 400s the rest (INVARIANTS §9 is per host).
 * No `server-only`: the SPA imports the types.
 */

/**
 * Every window either host can ask for. `31d` is a legacy fixed window (not a
 * switcher option) kept for `channels/components/thread-activity.tsx ›
 * ThreadActivityStrip` so its window doesn't move by a day.
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
 * Bins and bucket per window. `month`'s `bins` is computed in
 * {@link overviewWindows}; the 31 here only keeps the record total.
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
 * The bins for one range, oldest first. A rolling range's last bin is partial
 * ("so far today") — never extend it into the future.
 *
 * `month` is the whole CALENDAR month (28..31 bins), the one range reaching into
 * the future: month-to-date would render one stretched bar on the 1st. Future
 * bins are zero on purpose — the axis is the frame.
 *
 * R-40: `home/server/service-overview.ts` re-exports this, so both hosts share
 * one calendar.
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
    // Day 0 of next month = last day of this one; no leap-year table.
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

/** The first bin's start, so a payload's totals and bars describe the SAME window. */
export function overviewSince(
  range: OverviewSeriesRange,
  now: Date = new Date()
): string {
  const windows = overviewWindows(range, now);
  return windows[0]?.startIso ?? now.toISOString();
}

/**
 * Ledger rows into zero-filled `[start, end)` bins. A row outside every bin (the
 * boundary can move between reads) is dropped, not folded into the nearest bar.
 * Always the full bin count, never empty — the page never loses its axis.
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

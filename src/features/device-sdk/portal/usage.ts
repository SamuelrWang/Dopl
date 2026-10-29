/**
 * DEVELOPER PORTAL USAGE (P3, Plans/Dopl SDK Split › §6). Pure: no DB, no React.
 *
 * The usage page charts billable calls (`dev_billable_events`, never `dev_events`) in fixed UTC
 * buckets: hourly for the last 24 hours, daily for 7 or 30 days. The last bucket is the current,
 * partial one, so the chart ends "now".
 */
import type { RawSearchParams } from "./scope";

export const USAGE_RANGES = ["24h", "7d", "30d"] as const;
export type UsageRange = (typeof USAGE_RANGES)[number];

export const USAGE_RANGE_LABEL: Record<UsageRange, string> = {
  "24h": "24 hours",
  "7d": "7 days",
  "30d": "30 days",
};

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

export interface UsageBucket {
  /** Stable key: the bucket start, ISO. */
  key: string;
  startIso: string;
  /** Exclusive. */
  endIso: string;
  /** Axis label: `14:00` (hourly) or `Oct 28` (daily), UTC. */
  tick: string;
}

/** `?range=` → a range; anything else reads as the default 30 days. */
export function parseUsageRange(raw: RawSearchParams): UsageRange {
  const v = raw.range;
  const s = Array.isArray(v) ? v[0] : v;
  return (USAGE_RANGES as readonly string[]).includes(s ?? "") ? (s as UsageRange) : "30d";
}

const dayTick = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone: "UTC" });

/** The range's buckets, oldest first, the last one holding `now`. */
export function usageBuckets(range: UsageRange, now: Date): UsageBucket[] {
  const hourly = range === "24h";
  const size = hourly ? HOUR : DAY;
  const count = hourly ? 24 : range === "7d" ? 7 : 30;
  const t = now.getTime();
  const currentStart = t - (t % size);
  const out: UsageBucket[] = [];
  for (let i = count - 1; i >= 0; i--) {
    const start = currentStart - i * size;
    const end = start + size;
    const startIso = new Date(start).toISOString();
    out.push({
      key: startIso,
      startIso,
      endIso: new Date(end).toISOString(),
      tick: hourly ? `${startIso.slice(11, 13)}:00` : dayTick.format(new Date(start)),
    });
  }
  return out;
}

export interface UsagePoint extends UsageBucket {
  calls: number;
  failed: number;
}

export interface UsageSummary {
  points: UsagePoint[];
  calls: number;
  failed: number;
  /** Share of calls that succeeded, 0..1, or null when there were none. */
  successRate: number | null;
}

export function summarizeUsage(points: UsagePoint[]): UsageSummary {
  const calls = points.reduce((n, p) => n + p.calls, 0);
  const failed = points.reduce((n, p) => n + p.failed, 0);
  return { points, calls, failed, successRate: calls === 0 ? null : (calls - failed) / calls };
}

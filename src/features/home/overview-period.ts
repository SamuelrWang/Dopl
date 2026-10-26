import {
  HOME_OVERVIEW_DEFAULT_METRIC,
  HOME_OVERVIEW_DEFAULT_RANGE,
  USAGE_SCOPE_ALL,
} from "./overview-types";

/** The /home Overview's credit histogram period: a scope and a `YYYY-MM` month. */

/** `YYYY-MM` of `at` in UTC, the calendar the server bins by. */
export function monthKey(at: Date = new Date()): string {
  return `${at.getUTCFullYear()}-${String(at.getUTCMonth() + 1).padStart(2, "0")}`;
}

/** `YYYY-MM` ± n months, carrying the year. */
export function shiftMonthKey(key: string, delta: number): string {
  const [year = "", month = ""] = key.split("-");
  return monthKey(new Date(Date.UTC(Number(year), Number(month) - 1 + delta, 1)));
}

/** `"2026-09"` → `"September 2026"`. */
export function monthLabel(key: string): string {
  const [year = "", month = ""] = key.split("-");
  return new Date(Date.UTC(Number(year), Number(month) - 1, 1)).toLocaleDateString("en-US", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
}

/** A UTC bin's `at` → `"Sep 3"`, read in UTC so a bin never names its neighbour's day. */
export function utcDayLabel(at: string): string {
  return new Date(at).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
}

/** The histogram's read. A default selection sends neither param, so the first read is the one
 *  cache entry the face always had. */
export function usageSeriesPath(scope: string, month: string): string {
  const params = [`range=${HOME_OVERVIEW_DEFAULT_RANGE}`, `metric=${HOME_OVERVIEW_DEFAULT_METRIC}`];
  if (scope !== USAGE_SCOPE_ALL) params.push(`channel=${scope}`);
  if (month !== monthKey()) params.push(`month=${month}`);
  return `/api/home/overview-series?${params.join("&")}`;
}

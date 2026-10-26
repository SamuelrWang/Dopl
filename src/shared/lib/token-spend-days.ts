/**
 * The token-spend report's local-day arithmetic, shared by the /home Overview's Tokens card and the
 * workspace Overview's strip. The server sends one instant per run and no day, because it cannot
 * know the operator's zone; days are bucketed here from the raw rows.
 */

/** One entry per run, newest first. Mirrors the server's report shape. */
export interface TokenSpendReport {
  marks: Array<{ at: string; tokens: number }>;
  truncated: boolean;
}

export const TOKEN_SPEND_WINDOW_DAYS = 31;

/** An instant → the operator's calendar day, `YYYY-MM-DD`. Local getters: `toISOString()` names
 *  the UTC day, which west of Greenwich is tomorrow for most of the evening. */
export function localDayKey(at: Date): string {
  const month = String(at.getMonth() + 1).padStart(2, "0");
  const day = String(at.getDate()).padStart(2, "0");
  return `${at.getFullYear()}-${month}-${day}`;
}

/** A local day key → `"Sep 3"`, built from its parts so no zone shifts it. */
export function localDayLabel(key: string): string {
  const [year = "", month = "", day = ""] = key.split("-");
  return new Date(Number(year), Number(month) - 1, Number(day)).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });
}

/** The window's day keys, oldest first. Built by day arithmetic, not by subtracting 86 400 000ms,
 *  which drifts across a DST boundary and repeats a day. */
export function windowDays(count: number = TOKEN_SPEND_WINDOW_DAYS): string[] {
  const now = new Date();
  const out: string[] = [];
  for (let i = count - 1; i >= 0; i -= 1) {
    out.push(localDayKey(new Date(now.getFullYear(), now.getMonth(), now.getDate() - i)));
  }
  return out;
}

/**
 * Runs → the day columns they belong in, plus the header's total and run count, summed from the
 * same buckets. The server hauls a slightly wider window, so a run outside the drawn days is dropped
 * from everything; an unparseable instant (a persisted row from an older bundle) is dropped too.
 */
export function bucketByLocalDay(
  marks: ReadonlyArray<{ at: string; tokens: number }>,
  days: readonly string[]
): { byDay: Map<string, number>; total: number; runs: number } {
  const inWindow = new Set(days);
  const byDay = new Map<string, number>();
  let total = 0;
  let runs = 0;
  for (const mark of marks) {
    const at = new Date(mark.at);
    if (Number.isNaN(at.getTime())) continue;
    const key = localDayKey(at);
    if (!inWindow.has(key)) continue;
    byDay.set(key, (byDay.get(key) ?? 0) + mark.tokens);
    total += mark.tokens;
    runs += 1;
  }
  return { byDay, total, runs };
}

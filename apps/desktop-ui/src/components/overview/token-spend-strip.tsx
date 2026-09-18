/**
 * THE TOKEN-SPEND STRIP — the 31-local-day column chart both Overviews draw,
 * and the local-day arithmetic behind it (Samuel, #1326; shared in wave 8).
 *
 * ⚠ **THE NUMBER IS A FLOOR AND THE STRIP SAYS SO IN WORDS.** Two inherited
 * under-counts, both rounding DOWN: the desktop quantizes the reported figure to
 * 10 000-token buckets, and an ended run's final stretch is never pushed
 * (`session-state-push.js › liveForWire` drops ended rows). "At least this many"
 * is always true; "exactly this many" never is. ⚠ Do not let a later pass drop
 * that line to tidy the header — a spend figure that looks exact is one somebody
 * will reconcile against a bill.
 *
 * 🔒 **DAYS ARE THE OPERATOR'S LOCAL DAYS, AND THIS FILE IS WHERE THEY ARE
 * NAMED (Samuel's ruling, 2026-09-06).** The server sends one INSTANT per run
 * and no day at all, because it cannot know the zone; this component buckets
 * them with local calendar arithmetic, from the raw rows and never by shifting
 * UTC labels.
 * ⚠ **THE COLUMNS AND THE HEADER ARE SUMMED FROM THE SAME BUCKETS.** A total
 * counted over the server's wider haul would include runs no column draws, which
 * is one card showing two numbers.
 * ⚠ **DST IS WHY THE AXIS IS BUILT WITH `new Date(y, m, d - i)` AND NOT BY
 * SUBTRACTING 86 400 000ms.** Two days a year are 23 or 25 hours long, and the
 * millisecond walk drifts across the boundary and emits one day twice.
 *
 * ⚠ **A DAY WITH NO SPEND IS ABSENT FROM THE PAYLOAD, AND THIS DRAWS IT AS AN
 * EMPTY COLUMN** — the axis is built from the window, not from the points, so a
 * quiet week reads as a quiet week instead of vanishing from the strip.
 *
 * ⚠ **EXTRACTED FROM `pages/home/overview-token-spend.tsx`, UNCHANGED** (R-40).
 * The workspace Overview draws the same strip over its own container's rows.
 */

import { formatTokens } from "@/shared/lib/format-tokens";

// ⚠ RE-EXPORTED so `pages/home/overview-token-spend.tsx`'s shim keeps its shape.
// The declaration moved to `src/shared/` on 2026-09-17: the channels Agents tab
// held a second one that rounded to NEAREST, and this file's floor is the one
// the honesty line above depends on.
export { formatTokens };

/** ONE ENTRY PER RUN, newest first, and no days in it. ⚠ Mirrors the server's
 *  report shape; the desktop UI cannot import server types. */
export interface TokenSpendReport {
  marks: Array<{ at: string; tokens: number }>;
  truncated: boolean;
}

export const TOKEN_SPEND_WINDOW_DAYS = 31;

export function TokenSpendStrip({
  report,
  /** ONE line naming WHOSE spend this is. ⚠ Required on the workspace host,
   *  where the panel sits in a room full of other people's agents and an
   *  unlabelled figure would read as the container's total — which is exactly
   *  what the operator fence refuses to answer. */
  scopeNote,
}: {
  report: TokenSpendReport;
  scopeNote?: string;
}) {
  const days = windowDays(TOKEN_SPEND_WINDOW_DAYS);
  const { byDay, total, runs } = bucketByLocalDay(report.marks, days);
  // ⚠ THE TALLEST COLUMN SETS THE SCALE, never a constant: spend spans orders of
  // magnitude between operators, and a fixed ceiling makes every strip either
  // flat or clipped. `Math.max(1, …)` keeps the divisor off zero.
  const peak = Math.max(1, ...days.map((day) => byDay.get(day) ?? 0));

  return (
    <>
      <div className="flex items-baseline justify-between gap-2">
        <p className="text-sm font-semibold text-text-primary">
          {formatTokens(total)} tokens
        </p>
        <p className="text-label text-text-secondary">
          {runs} {runs === 1 ? "session" : "sessions"} · 31 days
        </p>
      </div>

      <div className="flex h-16 items-end gap-[3px]" aria-hidden="true">
        {days.map((day) => {
          const tokens = byDay.get(day) ?? 0;
          return (
            <div
              key={day}
              className="flex-1 rounded-sm bg-accent/70"
              // ⚠ A MEASURED ZERO STILL DRAWS A HAIRLINE (2%), so "this day was
              // counted and was quiet" is visibly different from the day being
              // off the end of the window. A 0-height column is indistinguishable
              // from no column at all.
              style={{ height: `${tokens === 0 ? 2 : Math.max(6, (tokens / peak) * 100)}%` }}
            />
          );
        })}
      </div>

      {/* ⚠ THE HONESTY LINE. See this file's header — it is load-bearing, not
          decoration. */}
      <p className="text-label text-text-secondary">
        {scopeNote ? `${scopeNote} ` : ""}At least this many: reported spend is
        rounded down and a session&apos;s last moments are not counted.
        {report.truncated && " Older sessions in this window are not included."}
      </p>
    </>
  );
}

/**
 * ONE INSTANT → THE OPERATOR'S CALENDAR DAY, `YYYY-MM-DD`.
 *
 * ⚠ **LOCAL GETTERS, NEVER `toISOString().slice(0, 10)`** — that reads the UTC
 * day, which west of Greenwich is tomorrow's for most of the evening. This is
 * the same bug `charts/bar-series.tsx › monthDayLabel` records from the other
 * direction (there, a UTC bin must NOT be parsed into local time).
 */
export function localDayKey(at: Date): string {
  const month = String(at.getMonth() + 1).padStart(2, "0");
  const day = String(at.getDate()).padStart(2, "0");
  return `${at.getFullYear()}-${month}-${day}`;
}

/**
 * The window's day keys, oldest first, in the OPERATOR'S zone.
 *
 * ⚠ **DAY ARITHMETIC, NOT MILLISECOND ARITHMETIC.** `new Date(y, m, d - i)`
 * normalises across month and year ends AND across DST: a 23-hour day walked by
 * 86 400 000ms lands at 23:00 the previous evening and repeats a key.
 */
export function windowDays(count: number): string[] {
  const now = new Date();
  const out: string[] = [];
  for (let i = count - 1; i >= 0; i -= 1) {
    out.push(
      localDayKey(new Date(now.getFullYear(), now.getMonth(), now.getDate() - i))
    );
  }
  return out;
}

/**
 * RUNS → THE COLUMNS THEY BELONG IN, plus the header's two figures.
 *
 * ⚠ **A MARK OUTSIDE THE DRAWN WINDOW IS DROPPED FROM EVERYTHING, INCLUDING THE
 * TOTAL.** The server hauls a slightly WIDER window than 31 local days on
 * purpose, so the oldest column is never short — and a run that falls off the
 * front of the axis must not be summed into a header the strip beneath it cannot
 * show. The header says "31 days"; this is what makes that sentence true.
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
    // ⚠ AN UNPARSEABLE INSTANT IS DROPPED, not bucketed as today: this payload
    // is IndexedDB-persisted (§8), so a row written by an older bundle can
    // arrive in a shape this build does not read, and `NaN` would take the whole
    // strip's scale with it.
    if (Number.isNaN(at.getTime())) continue;
    const key = localDayKey(at);
    if (!inWindow.has(key)) continue;
    byDay.set(key, (byDay.get(key) ?? 0) + mark.tokens);
    total += mark.tokens;
    runs += 1;
  }
  return { byDay, total, runs };
}

/**
 * The workspace Overview's token-spend strip: 31 local-day columns over the caller's own runs.
 *
 * ⚠ THE NUMBER IS A FLOOR AND THE STRIP SAYS SO IN WORDS. The desktop quantizes the reported
 * figure to 10 000-token buckets and an ended run's final stretch is never pushed
 * (`session-state-push.js › liveForWire` drops ended rows). A spend figure that looks exact is one
 * somebody will reconcile against a bill, so the honesty line stays.
 *
 * The day arithmetic is `src/shared/lib/token-spend-days.ts`, shared with /home's Tokens card.
 */

import { formatTokens } from "@/shared/lib/format-tokens";
import {
  TOKEN_SPEND_WINDOW_DAYS,
  bucketByLocalDay,
  windowDays,
  type TokenSpendReport,
} from "@/shared/lib/token-spend-days";

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
  // The tallest column sets the scale: spend spans orders of magnitude between operators.
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

      <div className="flex h-16 items-end gap-0.75" aria-hidden="true">
        {days.map((day) => {
          const tokens = byDay.get(day) ?? 0;
          return (
            <div
              key={day}
              className="flex-1 rounded-sm bg-accent/70"
              // A measured zero still draws a hairline, so a quiet day differs from no column.
              style={{ height: `${tokens === 0 ? 2 : Math.max(6, (tokens / peak) * 100)}%` }}
            />
          );
        })}
      </div>

      <p className="text-label text-text-secondary">
        {scopeNote ? `${scopeNote} ` : ""}At least this many: reported spend is
        rounded down and a session&apos;s last moments are not counted.
        {report.truncated && " Older sessions in this window are not included."}
      </p>
    </>
  );
}

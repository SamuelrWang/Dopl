import type { ReactNode } from "react";
import { cn } from "@/shared/lib/utils";
import { UsageMeter } from "@/shared/ui/usage-meter";
import { formatDate } from "@/shared/lib/format-time";
import { PERSONAL_MONTHLY_CREDITS } from "@/features/billing/credits";
import type { WorkspaceCreditsStatus } from "@/features/billing/components/use-workspace-entitlements";
import type {
  HomeOverviewBucket,
  HomeSeriesPoint,
} from "@/features/home/overview-types";
import {
  BarSeries,
  monthDayLabel,
  type BarPoint,
} from "#/components/charts/bar-series";
import { PAGE_ACTION_BTN } from "./panel-buttons";

/** The /home Overview Usage panel's contents: the capacity bar and the month histogram. */

/* --------------------------- the capacity bar --------------------------- */

/**
 * This period's allowance: the billing surface's own `UsageMeter` (used / limit), then credits
 * left and the reset date — all three required. The one sanctioned concave surface on /home
 * (the no-concave sweep names it).
 * - `spent` is the wallet counter, the figure enforcement charged; the plot below is the looser
 *   ledger and may legitimately read lower, never higher.
 * - A `limit` of 0 (payer never resolved) falls back to the personal wallet's FREE allowance,
 *   imported, never a literal: a denominator is not a measurement (INVARIANTS §11).
 * - `over` is the payload's verdict, never `spent >= limit`: out-of-credits is a fact about the
 *   payer's counter, which is what pauses tool calls.
 */
export function CreditCapacityBar({
  credits,
  spent,
  onUpgrade,
}: {
  credits: WorkspaceCreditsStatus;
  /** This period's spend off the wallet counter (`/api/billing/status › credits.used`). */
  spent: number;
  /** Opens settings on billing. Absent = nothing to sell (the caller decides). */
  onUpgrade?: () => void;
}) {
  const exhausted = credits.remaining === 0 && credits.limit > 0;
  const limit =
    credits.limit > 0 ? credits.limit : PERSONAL_MONTHLY_CREDITS.free;
  // From the limit above, not `credits.remaining`: on a degraded row that is a zero against a zero.
  const remaining = Math.max(0, limit - spent);
  return (
    // No card frame of its own: the caller's `.bento` is the card.
    <div className="w-full">
      {/* No label on the meter: the panel is titled Usage and the card Credit spend. */}
      <UsageMeter
        className=""
        used={spent}
        limit={limit}
        over={exhausted}
        overNote="Tool calls are paused until the next period."
      />
      <div className="mt-2 flex items-baseline justify-between gap-3 text-caption text-text-muted">
        <span>{remaining.toLocaleString()} left</span>
        {/* Counter vs ledger, subtracted by the server (`credits-audit.ts › walletMatchesLedger`,
            F-693); nothing when they agree. Never derived client-side: the plot is a capped scan. */}
        {credits.ledgerDrift !== 0 && <span>Unreconciled</span>}
        {/* The charge path failed open (`credits-unmetered.ts`): a fault, not `degraded`, and never
            derived from `used === 0` — a quiet month and an outage read the same from here. */}
        {credits.unmeteredSince && <span>Unmetered</span>}
        {/* Blank on the degraded fallback status; an unmeasured date is never invented. */}
        {credits.periodEnd && <span>Resets {formatDate(credits.periodEnd)}</span>}
      </div>
      {/* "New channel"'s own class list (`PAGE_ACTION_BTN`), by import. */}
      {onUpgrade && (
        <div className="mt-2.5 flex justify-end">
          <button type="button" onClick={onUpgrade} className={PAGE_ACTION_BTN}>
            Get more credits
          </button>
        </div>
      )}
    </div>
  );
}

/* -------------------------------- chart -------------------------------- */

/** The plotted window's total. */
export function seriesTotal(points: readonly HomeSeriesPoint[]): number {
  return points.reduce((sum, point) => sum + point.count, 0);
}

/** `at` → the bin's caption: `HH:00` for hour bins, else `bar-series.tsx › monthDayLabel`. */
function binLabel(at: string, bucket: HomeOverviewBucket): string {
  if (bucket === "hour") return `${at.slice(11, 13)}:00`;
  return monthDayLabel(at);
}

/**
 * The month histogram — credits only, no metric switcher. The server zero-fills the whole month,
 * so the axis is always drawn and a young ledger reads as a flat month.
 */
export function UsageChart({
  points,
  bucket,
  loading,
  truncated,
  scopeControl,
  monthControl,
}: {
  points: readonly HomeSeriesPoint[];
  bucket: HomeOverviewBucket;
  /** Dim the plot while the next read lands; the previous series stays up. */
  loading: boolean;
  /** The credit haul came back AT its ceiling, so the bars are a floor. */
  truncated: boolean;
  /** A slot: the selection decides the caller's read path, so the state lives with the fetch. */
  scopeControl?: ReactNode;
  /** The month arrows; they move this plot only, never the capacity bar. */
  monthControl?: ReactNode;
}) {
  const total = seriesTotal(points);
  const bars: BarPoint[] = points.map((point) => ({
    key: point.at,
    label: binLabel(point.at, bucket),
    value: point.count,
  }));

  return (
    // A `<div>`: the card around it is the named region.
    <div className="min-w-0">
      {/* The total is the plot's own bars, so a narrowed scope or past month differs from the bar
          above by design. */}
      <div className="flex items-center justify-between gap-3">
        {scopeControl}
        <div className="flex min-w-0 shrink-0 items-center gap-2">
          {monthControl}
          <span className="font-mono text-micro tabular-nums text-text-primary">
            {total.toLocaleString()}
          </span>
        </div>
      </div>
      {bars.length === 0 ? (
        // Only before the read lands: an empty ledger still yields a month of zero bars.
        <p className="mt-3 text-caption text-text-muted">Nothing yet.</p>
      ) : (
        <>
          <BarSeries
            points={bars}
            className={cn("mt-3 transition-opacity", loading && "opacity-60")}
          />
          {/* A clipped read says so, beside what it clipped (INVARIANTS §9). */}
          {truncated && (
            <p className="mt-2 text-caption text-text-muted">Newest rows only.</p>
          )}
        </>
      )}
    </div>
  );
}

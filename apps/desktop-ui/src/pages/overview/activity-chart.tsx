import { SegmentedControl } from "@/shared/ui/segmented-control";
import type {
  OverviewSeriesMetric,
  OverviewSeriesPoint,
  WorkspaceSeriesRange,
} from "@/features/workspaces/types";
import { WORKSPACE_SERIES_SWITCHER_RANGES } from "@/features/workspaces/types";
import {
  BarSeries,
  monthDayLabel,
  type BarPoint,
} from "#/components/charts/bar-series";

const TITLES: Record<OverviewSeriesMetric, string> = {
  messages: "Messages per day",
  mcp: "MCP calls per day",
  threads: "Threads per day",
  credits: "Credits per day",
};

const OPTIONS: ReadonlyArray<{ key: OverviewSeriesMetric; label: string }> = [
  { key: "credits", label: "Credits" },
  { key: "messages", label: "Messages" },
  { key: "mcp", label: "MCP calls" },
  { key: "threads", label: "Threads" },
];

/** The switcher's three windows. ⚠ Derived from the wire contract, never
 *  re-listed: a fourth range added there must not need a second edit here. */
const RANGE_LABELS: Record<WorkspaceSeriesRange, string> = {
  "7d": "7d",
  "30d": "30d",
  "31d": "31d",
  month: "Month",
};

const RANGES = WORKSPACE_SERIES_SWITCHER_RANGES.map((key) => ({
  key,
  label: RANGE_LABELS[key],
}));

/**
 * THE WORKSPACE OVERVIEW'S ONE SERIES CARD — metric × range, over one plot.
 *
 * ⚠ **THE PLOT IS `#/components/charts/bar-series` AND THIS IS THE CARD.**
 * /home's Overview draws the same histogram over a different series; the axis
 * ladder, the gridlines and the bar geometry are stated once. The heading, the
 * period total and the two switchers stayed because they are this page's copy —
 * `BarSeries` renders a plot and owns no words.
 *
 * 🔒 **`credits` AND THE RANGE SWITCHER LANDED IN WAVE 8 (R-29(b)), AND THEY
 * LANDED ON THIS CARD RATHER THAN BESIDE IT.** A second chart for credits would
 * be the duplication the ruling is about: one series, one card, `metric` and
 * `range` as the two things the reader switches.
 * 🔒 **THE CREDITS ARM IS THIS CONTAINER'S SEAT WALLETS AND THE METERS DO NOT
 * MIX** (`workspaces/server/service-usage.ts › isWorkspaceSeatBurn`). The figure
 * above it — `PeriodStats`, off `/api/billing/status` — is the caller's own seat
 * counter for the current period, so the two agree only on `range=month` and
 * only for a one-member container. ⚠ **Do not "fix" that by summing wallets.**
 *
 * ⚠ **NO `24h`.** This payload's bin is a UTC calendar DAY
 * (`OverviewSeriesPoint.date`); an hour has no field to travel in here. The
 * argument is in `workspaces/types.ts › WorkspaceSeriesRange`.
 */
export function ActivityChart({
  metric,
  onMetricChange,
  range,
  onRangeChange,
  days,
  truncated,
}: {
  metric: OverviewSeriesMetric;
  onMetricChange: (next: OverviewSeriesMetric) => void;
  range: WorkspaceSeriesRange;
  onRangeChange: (next: WorkspaceSeriesRange) => void;
  days: OverviewSeriesPoint[];
  /** The `credits` haul came back AT its ceiling — the total is then a FLOOR and
   *  the card says so (§9). Always false for the counted metrics. */
  truncated?: boolean;
}) {
  const total = days.reduce((sum, day) => sum + day.count, 0);
  const points: BarPoint[] = days.map((day) => ({
    key: day.date,
    label: monthDayLabel(day.date),
    value: day.count,
  }));

  return (
    <section className="bento p-3.5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        {/* Ink, not gray — Samuel, 2026-09-08: "their font colors are black
            not gray". The reference's header is one weight of near-black. */}
        <h2 className="text-label font-semibold uppercase tracking-wide text-text-primary">
          {TITLES[metric]}
        </h2>
        <div className="flex flex-wrap items-center gap-3">
          <span className="font-mono text-micro tabular-nums text-text-primary">
            {/* ⚠ **"at least" IS THE HONESTY LINE, not decoration** — a clipped
                haul is a floor, and a total that looks exact is one somebody
                will reconcile against a bill (§9). */}
            {truncated ? "at least " : ""}
            {total.toLocaleString()} in the period
          </span>
          <SegmentedControl<WorkspaceSeriesRange>
            options={RANGES}
            value={range}
            onChange={onRangeChange}
            ariaLabel="Range"
          />
          <SegmentedControl<OverviewSeriesMetric>
            options={OPTIONS}
            value={metric}
            onChange={onMetricChange}
          />
        </div>
      </div>

      {/* No `labelEvery`: the plot captions EVERY day now (Samuel: "we should
          be able to fit 30 days"), which is what the −45° slant buys. */}
      <BarSeries points={points} className="mt-4" />
    </section>
  );
}

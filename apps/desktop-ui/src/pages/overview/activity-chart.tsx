import { SegmentedControl } from "@/shared/ui/segmented-control";
import type {
  OverviewSeriesMetric,
  OverviewSeriesPoint,
} from "@/features/workspaces/types";
import { BarSeries, type BarPoint } from "#/components/charts/bar-series";

/** Label every Nth bar, counted BACK from today so the last bar always gets
 *  one. 31 `31/12`-wide labels at `text-micro` do not fit the plot width. */
const LABEL_EVERY = 5;

const TITLES: Record<OverviewSeriesMetric, string> = {
  messages: "Messages per day",
  mcp: "MCP calls per day",
  threads: "Threads per day",
};

const OPTIONS: ReadonlyArray<{ key: OverviewSeriesMetric; label: string }> = [
  { key: "messages", label: "Messages" },
  { key: "mcp", label: "MCP calls" },
  { key: "threads", label: "Threads" },
];

/** `YYYY-MM-DD` → `d/M`. Split, never `new Date()`: a UTC calendar day parsed
 *  as an instant lands on the previous day west of Greenwich. */
function dayLabel(date: string): string {
  const [, month = "", day = ""] = date.split("-");
  return `${Number(day)}/${Number(month)}`;
}

/**
 * One metric per day across the period.
 *
 * ⚠ **THE PLOT MOVED TO `#/components/charts/bar-series` (2026-09-01) AND WHAT
 * IS LEFT HERE IS THE CARD.** /home's Overview face draws the same histogram
 * over a different series; the axis ladder, the gridlines and the bar geometry
 * are now stated once. The heading, the period total and the metric switcher
 * stayed because they are this page's copy — `BarSeries` renders a plot and
 * owns no words.
 */
export function ActivityChart({
  metric,
  onMetricChange,
  days,
}: {
  metric: OverviewSeriesMetric;
  onMetricChange: (next: OverviewSeriesMetric) => void;
  days: OverviewSeriesPoint[];
}) {
  const total = days.reduce((sum, day) => sum + day.count, 0);
  const points: BarPoint[] = days.map((day) => ({
    key: day.date,
    label: dayLabel(day.date),
    value: day.count,
  }));

  return (
    <section className="bento p-3.5">
      <div className="flex items-center justify-between gap-4">
        <h2 className="text-label font-semibold uppercase tracking-wide text-text-secondary">
          {TITLES[metric]}
        </h2>
        <div className="flex items-center gap-3">
          <span className="font-mono text-micro tabular-nums text-text-muted">
            {total.toLocaleString()} in the period
          </span>
          <SegmentedControl<OverviewSeriesMetric>
            options={OPTIONS}
            value={metric}
            onChange={onMetricChange}
          />
        </div>
      </div>

      <BarSeries points={points} labelEvery={LABEL_EVERY} className="mt-4" />
    </section>
  );
}

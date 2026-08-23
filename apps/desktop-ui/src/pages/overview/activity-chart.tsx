import { SegmentedControl } from "@/shared/ui/segmented-control";
import type {
  OverviewSeriesMetric,
  OverviewSeriesPoint,
} from "@/features/workspaces/types";
import { cn } from "@/shared/lib/utils";

const PLOT_HEIGHT_CLASS = "h-40";

/** Gridline bands between the baseline and the ceiling. 4 bands = 5 labels. */
const TICK_BANDS = 4;

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

/**
 * Smallest ceiling ≥ `max` that divides into `TICK_BANDS` ROUND steps, so every
 * gridline label is a round number and every band is the same height.
 *
 * ⚠ The clone's axis was the hand-written list [3000,2000,1500,1000,500,0] laid
 * out `justify-between` — six labels on five equal bands, i.e. the 1500→2000
 * gap drawn the same height as 500→1000. Uniform steps are the fix; the ladder
 * is 1/2/5/10 (no 2.5, which puts halves on a single-digit axis).
 */
function niceCeiling(max: number): number {
  if (max <= 0) return TICK_BANDS;
  const rough = max / TICK_BANDS;
  const magnitude = 10 ** Math.floor(Math.log10(rough));
  const normalized = rough / magnitude;
  const step = (normalized <= 1 ? 1 : normalized <= 2 ? 2 : normalized <= 5 ? 5 : 10) * magnitude;
  return step * TICK_BANDS;
}

/** `YYYY-MM-DD` → `d/M`. Split, never `new Date()`: a UTC calendar day parsed
 *  as an instant lands on the previous day west of Greenwich. */
function dayLabel(date: string): string {
  const [, month = "", day = ""] = date.split("-");
  return `${Number(day)}/${Number(month)}`;
}

/**
 * One metric per day across the period. Plain divs, no chart library: 31 bars
 * on a fixed axis is layout, and a dependency here would arrive with its own
 * colours and type scale to fight the tokens.
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
  const ceiling = niceCeiling(Math.max(0, ...days.map((day) => day.count)));
  const ticks = Array.from(
    { length: TICK_BANDS + 1 },
    (_, index) => ceiling - (index * ceiling) / TICK_BANDS
  );
  const lastIndex = days.length - 1;

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

      <div className="mt-4 flex gap-2">
        {/* Y axis: labels sit on their own gridline, so the two columns share
            one flex-column rhythm rather than being positioned against each
            other. */}
        <div
          className={cn(
            PLOT_HEIGHT_CLASS,
            "flex shrink-0 flex-col justify-between pb-px text-right"
          )}
        >
          {ticks.map((tick) => (
            <span
              key={tick}
              className="-translate-y-1/2 font-mono text-micro tabular-nums text-text-muted"
            >
              {tick.toLocaleString()}
            </span>
          ))}
        </div>

        <div className="min-w-0 flex-1">
          <div className={cn(PLOT_HEIGHT_CLASS, "relative")}>
            <div
              aria-hidden="true"
              className="absolute inset-0 flex flex-col justify-between"
            >
              {ticks.map((tick) => (
                <span key={tick} className="border-t border-border-subtle" />
              ))}
            </div>
            <div className="relative flex h-full items-end gap-[3px]">
              {days.map((day, index) => (
                <span
                  key={day.date}
                  title={`${dayLabel(day.date)} · ${day.count.toLocaleString()}`}
                  style={{ height: `${Math.min(100, (day.count / ceiling) * 100)}%` }}
                  className={cn(
                    "min-w-0 flex-1 rounded-t-full",
                    // Today is the last point of the series, always.
                    index === lastIndex ? "bg-surface-cta" : "bg-surface-raised-4"
                  )}
                />
              ))}
            </div>
          </div>

          {/* Every bar keeps its own column so the ticks stay aligned; only
              every Nth carries text. */}
          <div className="mt-1.5 flex gap-[3px]">
            {days.map((day, index) => (
              <span
                key={day.date}
                className="min-w-0 flex-1 text-center font-mono text-micro tabular-nums text-text-muted"
              >
                {(lastIndex - index) % LABEL_EVERY === 0 ? dayLabel(day.date) : ""}
              </span>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}

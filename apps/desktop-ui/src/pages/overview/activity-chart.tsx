import { cn } from "@/shared/lib/utils";
import {
  CHART_BARS,
  CHART_GRIDLINES,
  CHART_HIGHLIGHT_INDEX,
  CHART_LABELS,
  CHART_MAX,
  CHART_NOTE,
  CHART_TITLE,
} from "./overview-data";

const PLOT_HEIGHT_CLASS = "h-40";

/**
 * Messages per day across the period. Plain divs, no chart library: 31 bars on
 * a fixed axis is layout, and a dependency here would arrive with its own
 * colours and type scale to fight the tokens.
 */
export function ActivityChart() {
  return (
    <section className="bento p-3.5">
      <div className="flex items-baseline justify-between gap-4">
        <h2 className="text-label font-semibold uppercase tracking-wide text-text-secondary">
          {CHART_TITLE}
        </h2>
        <span className="font-mono text-micro tabular-nums text-text-muted">
          {CHART_NOTE}
        </span>
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
          {CHART_GRIDLINES.map((tick) => (
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
              {CHART_GRIDLINES.map((tick) => (
                <span key={tick} className="border-t border-border-subtle" />
              ))}
            </div>
            <div className="relative flex h-full items-end gap-[3px]">
              {CHART_BARS.map((value, index) => (
                <span
                  key={CHART_LABELS[index]}
                  title={`${CHART_LABELS[index]} · ${value.toLocaleString()}`}
                  style={{ height: `${(value / CHART_MAX) * 100}%` }}
                  className={cn(
                    "min-w-0 flex-1 rounded-t-full",
                    index === CHART_HIGHLIGHT_INDEX
                      ? "bg-surface-cta"
                      : "bg-surface-raised-4"
                  )}
                />
              ))}
            </div>
          </div>

          <div className="mt-1.5 flex gap-[3px]">
            {CHART_LABELS.map((label) => (
              <span
                key={label}
                className="min-w-0 flex-1 text-center font-mono text-micro tabular-nums text-text-muted"
              >
                {label}
              </span>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}

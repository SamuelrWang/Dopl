import { cn } from "@/shared/lib/utils";

/**
 * THE bar histogram — a labelled Y axis, gridlines on round numbers, one bar
 * per bin, and every Nth bin captioned.
 *
 * ⚠ **EXTRACTED FROM `pages/overview/activity-chart.tsx` (2026-09-01), NOT
 * WRITTEN BESIDE IT.** /home's Overview face draws the same picture over a
 * different series, and a second copy of `niceCeiling` is a second axis ladder
 * one retune away from disagreeing with this one. What stayed behind in
 * `ActivityChart` is the CARD — its heading, its total and its metric
 * switcher — because those are that page's copy, not the plot's.
 *
 * ⚠ **PLAIN DIVS, NO CHART LIBRARY, AND THAT IS A STANDING DECISION.** At most
 * 31 bars on a fixed axis is layout, and a dependency here would arrive with
 * its own colours and type scale to fight the tokens (docs/DESIGN-SYSTEM.md:
 * no hand-rolled UI values, and equally no imported ones).
 */

/** Bands between the baseline and the ceiling. 4 bands = 5 labels. */
const TICK_BANDS = 4;

export const PLOT_HEIGHT_CLASS = "h-40";

export interface BarPoint {
  /** Stable identity for the bin — React's key, and never the label (two bins
   *  can legitimately render the same caption). */
  key: string;
  /** What the axis prints under this bin, when it prints one. */
  label: string;
  value: number;
}

/**
 * Smallest ceiling ≥ `max` that divides into {@link TICK_BANDS} ROUND steps, so
 * every gridline label is a round number and every band is the same height.
 *
 * ⚠ The ladder is 1/2/5/10 with no 2.5, which would put halves on a
 * single-digit axis.
 */
export function niceCeiling(max: number): number {
  if (max <= 0) return TICK_BANDS;
  const rough = max / TICK_BANDS;
  const magnitude = 10 ** Math.floor(Math.log10(rough));
  const normalized = rough / magnitude;
  const step =
    (normalized <= 1 ? 1 : normalized <= 2 ? 2 : normalized <= 5 ? 5 : 10) *
    magnitude;
  return step * TICK_BANDS;
}

export function BarSeries({
  points,
  labelEvery,
  className,
}: {
  points: BarPoint[];
  /**
   * Caption every Nth bin, counted BACK from the last one so the newest bin
   * always gets a label. A plot cannot fit a caption under every bar at
   * `text-micro`.
   */
  labelEvery: number;
  className?: string;
}) {
  const ceiling = niceCeiling(Math.max(0, ...points.map((point) => point.value)));
  const ticks = Array.from(
    { length: TICK_BANDS + 1 },
    (_, index) => ceiling - (index * ceiling) / TICK_BANDS
  );
  const lastIndex = points.length - 1;

  return (
    <div className={cn("flex gap-2", className)}>
      {/* Y axis: each label sits ON its gridline, so the two columns share one
          flex-column rhythm instead of being positioned against each other. */}
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
            {points.map((point, index) => (
              <span
                key={point.key}
                title={`${point.label} · ${point.value.toLocaleString()}`}
                style={{
                  height: `${Math.min(100, (point.value / ceiling) * 100)}%`,
                }}
                className={cn(
                  // 🔒 **`rounded-full` — A PROPORTIONAL RADIUS, SO ROUNDING IS
                  // VISIBLE AT EVERY BAR SIZE (Samuel, 2026-09-01, third time
                  // of asking: "the bar should always be rounded").**
                  // ⚠ **A FIXED `rounded-[3px]` WAS THE DEFECT AND IT WAS MINE.**
                  // 3px on a bar a few hundred pixels wide is visually square —
                  // which is exactly what he saw: one dominant bar rendering as
                  // a sharp black rectangle. A radius in ABSOLUTE px cannot hold
                  // "always rounded" across a plot whose bar width changes with
                  // the bin count. `rounded-full` is clamped by the browser to
                  // half the SHORTER side, so a 15px-wide daily bar gets ~7.5px
                  // and a wide one gets more — never zero, never square.
                  // ⚠ ALL FOUR CORNERS, not `rounded-t-full`: that one's radius
                  // also collapsed the bar into a dome and then a dot as the
                  // value approached zero.
                  // ⚠ SHARED — this plot is also the workspace Overview page's
                  // (`pages/overview/activity-chart.tsx`), and both change here.
                  "min-w-0 flex-1 rounded-full",
                  // The newest bin is the last point of the series, always.
                  index === lastIndex ? "bg-surface-cta" : "bg-surface-raised-4"
                )}
              />
            ))}
          </div>
        </div>

        {/* Every bin keeps its own column so the captions stay aligned under
            their bars; only every Nth carries text. */}
        <div className="mt-1.5 flex gap-[3px]">
          {points.map((point, index) => (
            <span
              key={point.key}
              className="min-w-0 flex-1 text-center font-mono text-micro tabular-nums text-text-muted"
            >
              {(lastIndex - index) % labelEvery === 0 ? point.label : ""}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}

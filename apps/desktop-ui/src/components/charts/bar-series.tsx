import { cn } from "@/shared/lib/utils";

/**
 * THE bar histogram — a labelled Y axis, gridlines on round numbers, one bar
 * per bin, and a slanted caption under EVERY bin.
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
 *
 * 🔒 **THE GEOMETRY IS A CLONE OF SAMUEL'S REFERENCE CHART (2026-09-08),
 * measured off it rather than invented:** a bar fills 80% of its day's slot and
 * the gaps share the other 20%; the bar is an opaque stadium pill that is never
 * shorter than it is wide; every day carries an `m/d` caption rotated −45°,
 * anchored under its own bar; and the ink is BLACK, not gray (verbatim: *"our
 * bars are too thick/wide … their bars are not transparent … i like the slanted
 * dates, it makes it able to fit. we should be able to fit 30 days … their font
 * colors are black not gray"*).
 */

/** Bands between the baseline and the ceiling. 4 bands = 5 labels. */
const TICK_BANDS = 4;

export const PLOT_HEIGHT_CLASS = "h-40";

/**
 * The share of its slot a bar fills; the remaining 20% is the gap. Measured off
 * the reference (34px bar on a 42px pitch), and it is a RATIO rather than a
 * width because the same plot is drawn at ~530px on the workspace Overview and
 * ~830px on /home.
 */
const BAR_SLOT_RATIO = 0.8;

/**
 * Ceiling on the never-shorter-than-it-is-wide floor below.
 *
 * ⚠ **THE FLOOR NEEDS A CAP BECAUSE THE BIN COUNT IS NOT FIXED.** A month is
 * 28..31 bins and a bar is then ~14-28px wide, which is the reference's own
 * proportion; a 7-bin range makes each bar ~95px wide, and an uncapped floor
 * would stand every empty day up as a 95px slab.
 */
const PILL_FLOOR_CAP = "28px";

/**
 * Below this plot width the −45° captions crowd each other: two adjacent ones
 * are `slot / √2` apart perpendicular to the text, so ~10.5px of `text-micro`
 * ink needs a slot of ~13.5px, and 31 of those need 420px.
 *
 * ⚠ **NOTHING IN THE APP IS THIS NARROW** — the SPA window's floor is 960px
 * (`dopl-desktop-app/main/spa-window.js › minWidth`), which leaves the workspace
 * Overview's plot ~530px and /home's ~830px. The thinning is the guard rail on
 * a plot dropped into a narrower column later, not a state either caller
 * reaches. ⚠ It is expressed as a CONTAINER query, so it answers to the PLOT's
 * width and not the viewport's; the container is established in place below.
 */
const THIN_CAPTIONS_BELOW = "@max-[420px]:hidden";

/**
 * `YYYY-MM-DD…` → `m/d`, the caption both callers print under a day bin.
 *
 * ⚠ SLICED OUT OF THE STRING, never `new Date()`: a UTC day parsed as an instant
 * lands on the previous day west of Greenwich.
 * 🔒 `m/d`, not `d/m` (Samuel, 2026-09-08: *"I'm seeing 29/9, which should be
 * 9/29"*) — the reference chart wore `d/m`; the audience is US.
 */
export function monthDayLabel(iso: string): string {
  const [, month = "", day = ""] = iso.slice(0, 10).split("-");
  return `${Number(month)}/${Number(day)}`;
}

export interface BarPoint {
  /** Stable identity for the bin — React's key, and never the label (two bins
   *  can legitimately render the same caption). It is the bin's DATE in both
   *  callers, which is what makes it addressable as `highlightKey`. */
  key: string;
  /** What the axis prints under this bin. */
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

/** Three decimals is under a tenth of a pixel at any width this plot is drawn. */
const cqw = (value: number) => `${value.toFixed(3)}cqw`;

export function BarSeries({
  points,
  highlightKey,
  className,
}: {
  points: BarPoint[];
  /**
   * The inked bin. Defaults to the LAST point, which is today in both callers
   * (their series are zero-filled through the current day).
   */
  highlightKey?: string;
  className?: string;
}) {
  const bins = points.length;
  const ceiling = niceCeiling(Math.max(0, ...points.map((point) => point.value)));
  const ticks = Array.from(
    { length: TICK_BANDS + 1 },
    (_, index) => ceiling - (index * ceiling) / TICK_BANDS
  );
  const lastIndex = bins - 1;
  const inked = highlightKey ?? points[lastIndex]?.key;

  // ⚠ **GEOMETRY IN CONTAINER-QUERY UNITS, NOT MEASURED PIXELS.** `1cqw` is 1%
  // of the plot column, so the bar's WIDTH and its pill FLOOR are the same
  // number by construction — a `ResizeObserver` would have to re-derive the
  // second from the first on every frame, and would render one frame of wrong
  // geometry before its first callback.
  const barWidth = bins > 0 ? (100 * BAR_SLOT_RATIO) / bins : 0;
  const gap = bins > 1 ? (100 * (1 - BAR_SLOT_RATIO)) / (bins - 1) : 0;
  const barW = cqw(barWidth);

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
            className="-translate-y-1/2 font-mono text-micro tabular-nums text-text-primary"
          >
            {tick.toLocaleString()}
          </span>
        ))}
      </div>

      {/* ⚠ `containerType` INLINE, NOT the `@container` utility: the bar floor
          below is a `cqw` length, so a build that failed to emit the class
          would not lose a breakpoint, it would collapse every zero bar to
          nothing. The caption thinning is a Tailwind container variant and
          answers to this same container. */}
      <div className="min-w-0 flex-1" style={{ containerType: "inline-size" }}>
        <div className={cn(PLOT_HEIGHT_CLASS, "relative")}>
          <div
            aria-hidden="true"
            className="absolute inset-0 flex flex-col justify-between"
          >
            {ticks.map((tick) => (
              <span key={tick} className="border-t border-border-subtle" />
            ))}
          </div>
          {/* `justify-between` spends the 20% that is not bar as the gaps, so
              the pitch stays even without a `gap` that has to agree with the
              width in a second place. */}
          <div className="relative flex h-full items-end justify-between">
            {points.map((point) => (
              <span
                key={point.key}
                title={`${point.label} · ${point.value.toLocaleString()}`}
                style={{
                  width: barW,
                  // 🔒 **A BAR IS NEVER SHORTER THAN IT IS WIDE**, so the
                  // smallest one is still a full pill rather than the dot a
                  // proportional radius used to collapse it into.
                  minHeight: `min(${barW}, ${PILL_FLOOR_CAP})`,
                  height: `${Math.min(100, (point.value / ceiling) * 100)}%`,
                }}
                className={cn(
                  // 🔒 **`rounded-full` — A PROPORTIONAL RADIUS, SO ROUNDING IS
                  // VISIBLE AT EVERY BAR SIZE (Samuel, 2026-09-01, third time
                  // of asking: "the bar should always be rounded").** A fixed
                  // `rounded-[3px]` was the defect: 3px on a wide bar is
                  // visually square. `rounded-full` is clamped by the browser to
                  // half the SHORTER side, and with the floor above the shorter
                  // side is never smaller than the width — a stadium pill with
                  // a cap at BOTH ends, which is the reference.
                  // 🔒 **SOLID, NOT A TINT (Samuel, 2026-09-08: "their bars are
                  // not transparent").** `--chart-bar` exists for exactly this:
                  // the `surface-raised-*` ramp is alpha on purpose and a bar
                  // wearing one takes the card's face and reads as a smudge.
                  // ⚠ SHARED — this plot is also the workspace Overview page's
                  // (`pages/overview/activity-chart.tsx`), and both change here.
                  "shrink-0 rounded-full",
                  point.key === inked ? "bg-surface-cta" : "bg-chart-bar"
                )}
              />
            ))}
          </div>
        </div>

        {/* 🔒 **EVERY BIN IS CAPTIONED, AND THAT IS WHAT THE SLANT BUYS
            (Samuel: "i like the slanted dates, it makes it able to fit. we
            should be able to fit 30 days").** Horizontal captions could not fit
            31 `31/12`s, so the plot used to print every 5th and the axis read as
            a sample of itself. Rotated −45° about their TOP-RIGHT corner, the
            captions are parallel lines whose spacing is the slot's, not the
            text's, so the label width stops mattering entirely.
            ⚠ Absolutely positioned by `right`, so the anchor corner lands on the
            BAR'S CENTRE — a flex column of equal cells would anchor them on the
            slot's edge and walk the whole row half a bar left. */}
        <div className="relative mt-2 h-9">
          {points.map((point, index) => (
            <span
              key={point.key}
              style={{
                right: `${(100 - (index * (barWidth + gap) + barWidth / 2)).toFixed(3)}%`,
              }}
              className={cn(
                "absolute top-0 origin-top-right rotate-[-45deg] whitespace-nowrap font-mono text-micro tabular-nums text-text-primary",
                // 🔒 Ink, not gray (Samuel: "their font colors are black not
                // gray") — the inked day is separated by WEIGHT, because the
                // colour it used to be separated by is now everyone's.
                point.key === inked && "font-medium",
                // Counted BACK from the last bin, so the inked day survives the
                // thinning and the row stays anchored on it.
                (lastIndex - index) % 2 === 1 && THIN_CAPTIONS_BELOW
              )}
            >
              {point.label}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}

"use client";

/**
 * THE THREAD-ACTIVITY DENSITY STRIP — the squares, and the arithmetic that
 * turns real counts into them (Samuel, 2026-08-25).
 *
 * ⚠ THE VISUAL IS THE ONE `info-tab.tsx` HAS ALWAYS DRAWN. What changed on
 * /home is where the numbers come from: that page's strip is
 * `fixtures.ts › HARDCODED_THREAD_ACTIVITY`, marked as such at its render site
 * since 2026-08-18, and the account surface now feeds the same squares from
 * `GET /api/workspaces/[workspaceSlug]/overview-series?metric=messages&channelId=`
 * — real daily counts for THIS channel. **The shade ramp lives here so the two
 * strips cannot drift apart while only one of them is wired** (F-316).
 *
 * ⚠ THE SQUARES MEAN SOMETHING AND THE LABEL SAYS WHAT. A density picture with
 * no stated unit is the failure mode this whole change is fixing: the reader
 * infers a meaning and the surface never claimed one. `label` is required, and
 * `ThreadActivityStrip` names the metric and the window in it.
 *
 * ⚠ IT NEVER GAP-FILLS AND NEVER INVENTS. The series is zero-filled SERVER-side
 * (`service-overview.ts › getWorkspaceOverviewSeries` counts every bin, so a
 * zero is a measured zero, not a missing one); this component only quantises.
 * A day the server did not count does not reach here — which is precisely why
 * the counting is per-bin rather than one hauling read (INVARIANTS §9).
 */

import { cn } from "@/shared/lib/utils";

/**
 * Heatmap shades, low → high. Opacity steps on the success token: the palette
 * carries one green, so density is expressed as strength, not as hue.
 *
 * ⚠ Exported since 2026-08-25 — `info-tab.tsx` declared its own copy, and two
 * copies of a five-step ramp is how two strips of the same object come to be
 * different colours.
 */
export const ACTIVITY_SHADE = [
  "bg-success/10",
  "bg-success/25",
  "bg-success/45",
  "bg-success/70",
  "bg-success",
] as const;

/** The minimum structural shape this reads — NOT `OverviewSeriesPoint`.
 *  Typing it by what it reads is what keeps a channels component free of a
 *  workspaces import (INVARIANTS §9). */
export interface ActivityBin {
  /** UTC calendar day, `YYYY-MM-DD`. */
  date: string;
  count: number;
}

/**
 * Counts → shade indices, relative to the busiest day in the window.
 *
 * ⚠ RELATIVE, NOT ABSOLUTE, and the choice is forced. There is no workspace-
 * independent "busy" — 4 messages a day is a lot for a two-person relationship
 * and nothing for a team room — so an absolute ramp would paint most home
 * channels uniformly pale and say nothing. The strip answers *when was this
 * channel busy, for this channel*, which is the only question a bare row of
 * squares can honestly answer with no axis and no legend.
 *
 * ⚠ ZERO IS ITS OWN THING: a measured zero returns `-1`, which the renderer
 * draws as an EMPTY well rather than as `ACTIVITY_SHADE[0]`. The palest green
 * and "nothing happened" must not be the same pixel — that is the exact
 * confusion between a low bin and an unmeasured one that the fixture version
 * could not avoid.
 *
 * Pure and exported: a quantiser that quietly stopped being relative looks
 * identical in a screenshot.
 */
export function activityLevels(bins: readonly ActivityBin[]): number[] {
  const max = bins.reduce((hi, bin) => Math.max(hi, bin.count), 0);
  if (max === 0) return bins.map(() => -1);
  return bins.map((bin) => {
    if (bin.count === 0) return -1;
    // Ceil, so any non-zero day reaches at least the palest step — a day with
    // one message must not round down into the empty face.
    const step = Math.ceil((bin.count / max) * ACTIVITY_SHADE.length);
    return Math.min(step, ACTIVITY_SHADE.length) - 1;
  });
}

/**
 * The strip itself, from already-quantised levels. `-1` is an empty well.
 *
 * Split from {@link ThreadActivityStrip} so the still-hardcoded caller
 * (`info-tab.tsx`) can render the identical squares from its fixture LEVELS
 * without being handed a way to pass off invented counts as measured ones.
 */
export function ActivityCells({
  levels,
  label,
  titles,
}: {
  levels: readonly number[];
  label: string;
  /**
   * PER-SQUARE HOVER TEXT — the day and its count (Samuel, 2026-09-05).
   *
   * ⚠ OPTIONAL, AND COMPOSED BY THE CALLER THAT HAS THE BINS. This component is
   * handed LEVELS precisely so it cannot pass invented counts off as measured
   * ones, and reading a date back out of a shade is not possible — so the only
   * caller that can title a square honestly is the one holding the series.
   * ⚠ A MISSING ENTRY IS `undefined`, so the square simply has no tooltip. An
   * invented "0 messages" would be the same lie the fixture was.
   */
  titles?: readonly string[];
}) {
  return (
    <div
      role="img"
      aria-label={label}
      className="flex flex-wrap gap-1 px-3.5 pt-1"
    >
      {levels.map((level, i) => (
        <span
          key={i}
          title={titles?.[i]}
          className={cn(
            "h-3.5 w-3.5 rounded-[4px]",
            level < 0
              ? "border border-border-subtle bg-bg-inset"
              : ACTIVITY_SHADE[level]
          )}
        />
      ))}
    </div>
  );
}

/**
 * The WIRED strip: real daily bins in, squares out.
 *
 * ⚠ IT RENDERS NOTHING WHILE THE READ IS IN FLIGHT — not a row of empty wells.
 * An empty well is a MEASURED zero here, so painting a full row of them during
 * loading would state thirty-one quiet days the server has not answered for
 * yet, which is the same lie as the fixture in a paler colour.
 */
export function ThreadActivityStrip({
  bins,
  loading,
  metricLabel,
}: {
  bins: readonly ActivityBin[];
  loading: boolean;
  /** What one square counts, e.g. "Messages". Named by the caller because the
   *  series' metric is the caller's choice. */
  metricLabel: string;
}) {
  if (loading && bins.length === 0) {
    return (
      <p role="status" aria-busy="true" className="sr-only">
        Loading thread activity
      </p>
    );
  }
  if (bins.length === 0) return null;
  return (
    <ActivityCells
      levels={activityLevels(bins)}
      label={`${metricLabel} in this channel per day, ${bins.length} days to ${bins[bins.length - 1].date}`}
      // ⚠ THE DATE AND THE COUNT, because a shade alone cannot be read back to
      // either. The count is the MEASURED number rather than the quantised
      // step: the squares are relative to the busiest day, so two identical
      // shades are routinely different numbers and a tooltip that repeated the
      // shade would say nothing the eye had not already got wrong.
      titles={bins.map((bin) => `${bin.date}: ${bin.count}`)}
    />
  );
}

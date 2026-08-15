"use client";

import { cn } from "@/shared/lib/utils";

/**
 * THE usage meter — a labelled "used / limit" bar.
 *
 * Extracted verbatim from the module-private `UsageMeter` in
 * `settings-modal/sections/plans-billing-core.tsx` when a SECOND meter (MCP
 * credits) was added beside the ontology-object one. `docs/DESIGN-SYSTEM.md`
 * records that no progress-bar primitive existed and that this recipe was the
 * sanctioned one; there were already two divergent hand-rolled bars elsewhere,
 * so the second copy became the primitive instead.
 *
 * THE RECIPE IS THE CONTRACT, and it is unchanged: `.concave-track` (a
 * recessed well with its own padding and deliberately NO `overflow:hidden`)
 * wrapping a bare `h-1.5 rounded-full transition-[width]` fill with an inline
 * width percentage. Tokens only — `text-caption` / `text-micro`,
 * `text-text-secondary` / `text-text-primary`, `bg-surface-cta`,
 * `text-warning` / `bg-warning` for the over state, and the
 * `bg-success`/`bg-caution`/`bg-warning`/`bg-danger` status ramp under
 * `tone="ramp"`. No hex, no raw px.
 */
export interface UsageMeterProps {
  /** Left-hand caption, e.g. "Ontology objects" or "MCP credits". */
  label: string;
  used: number;
  limit: number;
  /** Whether the meter reads as exceeded. The CALLER decides — "over" is an
   *  entitlement verdict (the free-cap gate), not `used >= limit` arithmetic. */
  over?: boolean;
  /** One line under the bar, shown only while `over`. Says what stopped and
   *  what did not — every gate in this product freezes, it never deletes. */
  overNote?: string;
  /** Spacing against whatever sits above. The default is what the original
   *  in-place meter used; pass a different one only with a reason. */
  className?: string;
  /**
   * How the FILL is coloured.
   *
   *   `"cta"`   (default) — the flat `bg-surface-cta` ink. The bar says how
   *             much, and only the header's `over` verdict says how bad.
   *   `"ramp"`  — the fill takes a status colour off HOW FULL it is:
   *             success → caution → warning → danger. For a meter the reader
   *             glances at rather than reads (a storage bar on a grid of
   *             cards), where the number is small and the colour is the whole
   *             message.
   *
   * `ramp` OWNS the fill outright, `over` included: at the top band it is
   * already `bg-danger`, which is the truer read of a full bar than the
   * `over` state's amber. `over` keeps the header and the note either way.
   */
  tone?: "cta" | "ramp";
  /**
   * How the two numbers are written. Defaults to `toLocaleString()`, which is
   * right for counts and wrong for bytes — a storage bar reading
   * "4,231,000 / 5,000,000" is not a sentence anyone parses. Pass
   * `shared/lib/format-bytes.ts › formatBytes` for a byte meter.
   *
   * A PROP RATHER THAN A THIRD HAND-ROLLED BAR: this component's own header
   * records that a second copy is how the recipe last fragmented.
   */
  formatValue?: (value: number) => string;
}

/*
 * `inline` — a `<span>`/`<div>` swap for a caller whose surface was itself a
 * `<button>` — was DELETED 2026-08-12. It existed for exactly one caller, the
 * knowledge home card, and that card stopped being a single `<button>` when it
 * grew a second control (a star) that could not legally nest inside one. With
 * the block elements valid again there is no caller left, and a phrasing-only
 * variant kept "for the next one" is a second rendering of the same recipe
 * waiting to drift from the first. Restore it from git if a genuinely
 * button-shaped surface ever needs a meter.
 */

/**
 * Fill colour for `tone="ramp"`, by percentage full. Four bands rather than a
 * smooth interpolation: the thresholds are the thing a reader is meant to
 * take away ("comfortable / getting on / nearly out / out"), and an
 * interpolated hue reads as a gradient nobody can name a point on.
 *
 * MODULE-PRIVATE: `tone="ramp"` is the whole public surface. A caller that
 * could reach the bands could paint them somewhere the meter is not, and the
 * ramp would fork the way the bar recipe already did once.
 */
function usageBandClass(pct: number): string {
  if (pct < 50) return "bg-success";
  if (pct < 75) return "bg-caution";
  if (pct < 90) return "bg-warning";
  return "bg-danger";
}

export function UsageMeter({
  label,
  used,
  limit,
  over = false,
  overNote,
  className = "mt-3",
  tone = "cta",
  formatValue,
}: UsageMeterProps) {
  const fmt = formatValue ?? ((value: number) => value.toLocaleString());
  // A zero/negative limit has no meaningful fill — render an empty track
  // rather than dividing by it.
  const pct = limit > 0 ? Math.min(100, Math.round((used / limit) * 100)) : 0;
  return (
    <div className={className}>
      <div className="mb-1.5 flex items-baseline justify-between text-caption">
        <span className="text-text-secondary">{label}</span>
        <span className={cn("font-medium", over ? "text-warning" : "text-text-primary")}>
          {fmt(used)} / {fmt(limit)}
        </span>
      </div>
      <div className="concave-track">
        <div
          className={cn(
            "h-1.5 rounded-full transition-[width]",
            tone === "ramp"
              ? usageBandClass(pct)
              : over
                ? "bg-warning"
                : "bg-surface-cta"
          )}
          style={{ width: `${pct}%` }}
        />
      </div>
      {over && overNote && (
        <p className="mt-1.5 text-micro text-text-secondary">{overNote}</p>
      )}
    </div>
  );
}

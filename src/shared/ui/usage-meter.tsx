"use client";

import { cn } from "@/shared/lib/utils";

/**
 * THE usage meter — the only "used / limit" bar recipe.
 *
 * THE RECIPE IS THE CONTRACT: `.concave-track` (recessed well, own padding,
 * deliberately NO `overflow:hidden`) wrapping a bare
 * `h-1.5 rounded-full transition-[width]` fill with an inline width %.
 * Tokens only — no hex, no raw px.
 */
/**
 * ⚠ EXPORTED WITH NO READER TODAY, AND THAT IS A DECISION (2026-10-12, X01):
 * it is `UsageMeter`'s own prop shape, i.e. kit API. All 7 importing files
 * (9 render sites, measured at this head) pass props inline rather than naming
 * the type, which is why a reader grep comes back empty. Keep it exported.
 */
export interface UsageMeterProps {
  /**
   * The noun to the left of the `used / limit` pair.
   *
   * ⚠ **OPTIONAL SINCE 2026-09-13, and only because ONE caller has no word to
   * put there** (Samuel, over the /home Usage card: *"remove the credits and the
   * 'Credits used' text"*). Omitting it drops the SPAN, not the row — the number
   * stays where it is, right-aligned above the track (`ml-auto` below is what
   * holds it there). Every other caller labels
   * its meter; a meter on a surface that does not already say what is being
   * measured must.
   */
  label?: string;
  used: number;
  limit: number;
  /** ⚠ CALLER decides. "over" is an entitlement verdict (free-cap gate), NOT
   *  `used >= limit` arithmetic. */
  over?: boolean;
  /** One line under the bar, only while `over`. Says what stopped and what did
   *  not — every gate in this product freezes, never deletes. */
  overNote?: string;
  className?: string;
  /**
   * `"cta"` (default) = flat `bg-surface-cta`; only `over` says how bad.
   * `"ramp"` = status colour off HOW FULL, for meters GLANCED at not read.
   * ⚠ `ramp` OWNS the fill outright, `over` included — at the top band it is
   * already `bg-danger`. `over` keeps the header and the note either way.
   */
  tone?: "cta" | "ramp";
  /** Defaults to `toLocaleString()` — right for counts, wrong for bytes. Pass
   *  `shared/lib/format-bytes.ts › formatBytes` for a byte meter. */
  formatValue?: (value: number) => string;
  /** Replaces the `used / limit` readout outright — a bar whose number is not a count (the
   *  channel display card's `progress` block reads `62%`). */
  readout?: string;
}

/** Zero/negative limit: an empty bar rather than dividing by it. */
function percentOf(used: number, limit: number): number {
  return limit > 0 ? Math.min(100, Math.round((used / limit) * 100)) : 0;
}

/**
 * `tone="ramp"` fill, by percent full. Four bands, not interpolation: the
 * thresholds are the takeaway, and an interpolated hue names no point.
 * MODULE-PRIVATE — a caller reaching the bands could paint them where the meter
 * is not, forking the ramp.
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
  readout,
}: UsageMeterProps) {
  const fmt = formatValue ?? ((value: number) => value.toLocaleString());
  const pct = percentOf(used, limit);
  /**
   * IS THERE A DENOMINATOR TO SHOW. A `limit` of 0 is "not measured": printing it would render
   * **"84k / 0k"** over an empty track, a fabricated denominator and an empty bar that reads as
   * headroom.
   *
   * ⚠ IT DROPS THE DENOMINATOR, NOT THE METER. The bar still renders unconditionally at 0, which
   * is the standing rule for these surfaces; what stops is the assertion nobody can support.
   * `used` IS known and is still shown — INVARIANTS §11: render what IS known, never a blank
   * standing in for it, and never a zero standing in for "not measured".
   */
  const hasLimit = limit > 0;
  return (
    <div className={className}>
      <div className="mb-1.5 flex items-baseline justify-between text-caption">
        {label ? <span className="text-text-secondary">{label}</span> : null}
        {/* ⚠ `ml-auto` IS WHAT MAKES THE LABEL OPTIONAL WITHOUT MOVING THE NUMBER.
            `justify-between` parks a LONE child at the START, so dropping the
            label slid the readout to the left edge of the card — the one thing the
            /home Usage ruling did not ask for. It is a no-op while a label is
            there, which is why it lives here rather than in a branch. */}
        <span
          className={cn(
            "ml-auto font-medium",
            over ? "text-warning" : "text-text-primary"
          )}
        >
          {readout ?? (hasLimit ? `${fmt(used)} / ${fmt(limit)}` : fmt(used))}
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

/**
 * The identity look's 3px meter (DESIGN-LANGUAGE §4): the bar alone, so the caller places the
 * readout, which carries the value (the bar is decorative).
 */
export function ThinMeter({
  used,
  limit,
  color,
  className,
}: {
  used: number;
  limit: number;
  /** A CSS colour for the fill (an agent's `agentColorVar`); ink without one. */
  color?: string | null;
  className?: string;
}) {
  return (
    <span
      aria-hidden="true"
      className={cn("relative block h-0.75 overflow-hidden rounded-full bg-surface-raised-4", className)}
    >
      <span
        className="absolute inset-y-0 left-0 rounded-full bg-text-primary transition-[width] duration-200"
        style={{ width: `${percentOf(used, limit)}%`, background: color ?? undefined }}
      />
    </span>
  );
}

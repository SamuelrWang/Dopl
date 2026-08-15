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
export interface UsageMeterProps {
  label: string;
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
}: UsageMeterProps) {
  const fmt = formatValue ?? ((value: number) => value.toLocaleString());
  // Zero/negative limit: empty track rather than dividing by it.
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

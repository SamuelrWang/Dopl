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
  /**
   * IS THERE A DENOMINATOR TO SHOW.
   *
   * ⚠ THE ARITHMETIC GUARD ABOVE WAS NOT THE WHOLE OF "OWNING THE MISSING DENOMINATOR", AND THE
   * READOUT IS WHERE IT LEAKED (2026-08-28). Two agent surfaces call this unconditionally —
   * `channels-v2/agent-panel.tsx › AgentStats` and `› AgentWindowStats` pass `used ?? 0` and
   * `limit ?? 0` — on the stated grounds that *"`UsageMeter` handles the missing denominator
   * itself"*. It handled it for the BAR. The number beside the label printed `{fmt(limit)}`
   * regardless, so an agent whose context USED is known but whose WINDOW is not rendered
   * **"84k / 0k"** over an empty track: a fabricated denominator, and an empty bar that reads as
   * headroom. `channels-v2/agent-metrics.ts › metric` exists to stop exactly this and names the
   * case — *"a model this build has no window for has no denominator … NONE of them means zero —
   * a context meter reading 0% of a window that is nearly full is a lie the operator acts on."*
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
        <span className="text-text-secondary">{label}</span>
        <span className={cn("font-medium", over ? "text-warning" : "text-text-primary")}>
          {hasLimit ? `${fmt(used)} / ${fmt(limit)}` : fmt(used)}
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

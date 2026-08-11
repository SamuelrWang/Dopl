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
 * `text-text-secondary` / `text-text-primary`, `bg-surface-cta`, and
 * `text-warning` / `bg-warning` for the over state. No hex, no raw px.
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
}

export function UsageMeter({
  label,
  used,
  limit,
  over = false,
  overNote,
  className = "mt-3",
}: UsageMeterProps) {
  // A zero/negative limit has no meaningful fill — render an empty track
  // rather than dividing by it.
  const pct = limit > 0 ? Math.min(100, Math.round((used / limit) * 100)) : 0;
  return (
    <div className={className}>
      <div className="mb-1.5 flex items-baseline justify-between text-caption">
        <span className="text-text-secondary">{label}</span>
        <span className={cn("font-medium", over ? "text-warning" : "text-text-primary")}>
          {used.toLocaleString()} / {limit.toLocaleString()}
        </span>
      </div>
      <div className="concave-track">
        <div
          className={cn(
            "h-1.5 rounded-full transition-[width]",
            over ? "bg-warning" : "bg-surface-cta"
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

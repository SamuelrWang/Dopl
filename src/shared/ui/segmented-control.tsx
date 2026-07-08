"use client";

import { cn } from "@/shared/lib/utils";

export interface SegmentedOption<K extends string = string> {
  key: K;
  label: string;
  /** Optional trailing count, rendered as a muted micro badge. */
  count?: number;
}

/**
 * Recessed segmented switcher — a `.concave-track` holding equal-width
 * slots and a single `.raised-tab` thumb that SLIDES between them
 * (0.28s ease-out-quint) instead of the highlight jumping. THE blessed
 * segmented-tabs primitive: any pane that needs scope/filter tabs
 * composes this instead of hand-rolling the track/thumb recipe, so the
 * animation stays identical everywhere.
 *
 * Geometry: the track has 4px padding and a 4px gap (matching
 * `.concave-track`), so a slot is (100% − 8px − gaps) / n and the thumb
 * travels its own width plus one gap per step.
 */
export function SegmentedControl<K extends string>({
  options,
  value,
  onChange,
  className,
}: {
  options: ReadonlyArray<SegmentedOption<K>>;
  value: K;
  onChange: (next: K) => void;
  /** Layout-only additions (margins, width) — recipes stay in the kit. */
  className?: string;
}) {
  const n = options.length;
  const index = Math.max(
    0,
    options.findIndex((o) => o.key === value)
  );
  return (
    <div
      role="tablist"
      className={cn(
        "concave-track relative flex items-center gap-1",
        className
      )}
    >
      <span
        aria-hidden
        className="raised-tab pointer-events-none absolute left-1 top-1 rounded-[7px]"
        style={{
          height: "calc(100% - 8px)",
          width: `calc((100% - 8px - ${(n - 1) * 4}px) / ${n})`,
          transform: `translateX(calc(${index} * (100% + 4px)))`,
          transition: "transform 0.28s cubic-bezier(0.22, 1, 0.36, 1)",
        }}
      />
      {options.map(({ key, label, count }) => (
        <button
          key={key}
          type="button"
          role="tab"
          aria-selected={value === key}
          onClick={() => value !== key && onChange(key)}
          className={cn(
            "relative z-[1] flex h-[27px] flex-1 cursor-pointer items-center justify-center gap-1.5 rounded-[7px] text-caption font-medium transition-colors",
            value === key
              ? "text-text-primary"
              : "text-text-secondary hover:text-text-primary"
          )}
        >
          {label}
          {count !== undefined && (
            <span className="text-micro text-text-muted">{count}</span>
          )}
        </button>
      ))}
    </div>
  );
}

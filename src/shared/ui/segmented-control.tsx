"use client";

import { cn } from "@/shared/lib/utils";

export interface SegmentedOption<K extends string = string> {
  key: K;
  label: string;
  /** Optional trailing count, rendered as a muted micro badge. */
  count?: number;
}

/**
 * THE segmented-tabs primitive — compose for any scope/filter tab row, never
 * hand-roll the pill recipe. TRACKLESS: each option is its own hug-width
 * `.seg-pill`, active swaps to `.raised-tab`. ⚠ Radius stays on the button and
 * both faces use ring-for-border, or the swap shifts layout. No sliding thumb —
 * hugging pills leave no fixed slot geometry to travel.
 */
export function SegmentedControl<K extends string>({
  options,
  value,
  onChange,
  disabled,
  className,
}: {
  options: ReadonlyArray<SegmentedOption<K>>;
  value: K;
  onChange: (next: K) => void;
  /** ⚠ Set while a write this control fired is in flight: a second click races
   *  the first, and the loser's rollback restores the winner's value. */
  disabled?: boolean;
  /** Layout-only (margins, width) — recipes stay in the kit. */
  className?: string;
}) {
  return (
    <div role="tablist" className={cn("flex items-center gap-1.5", className)}>
      {options.map(({ key, label, count }) => (
        <button
          key={key}
          type="button"
          role="tab"
          aria-selected={value === key}
          disabled={disabled}
          onClick={() => value !== key && onChange(key)}
          className={cn(
            "flex h-[27px] items-center justify-center gap-1.5 rounded-full px-3 text-caption font-medium transition-colors",
            value === key
              ? "raised-tab text-text-primary"
              : "seg-pill text-text-secondary hover:text-text-primary",
            disabled ? "cursor-not-allowed opacity-60" : "cursor-pointer"
          )}
        >
          {label}
          {count !== undefined &&
            (value === key ? (
              <span className="inline-flex h-[16px] min-w-[16px] items-center justify-center rounded-full bg-surface-cta px-1.5 text-micro font-semibold text-text-on-cta">
                {count}
              </span>
            ) : (
              <span className="text-micro text-text-muted">{count}</span>
            ))}
        </button>
      ))}
    </div>
  );
}

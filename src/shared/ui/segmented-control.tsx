"use client";

import { cn } from "@/shared/lib/utils";

export interface SegmentedOption<K extends string = string> {
  key: K;
  label: string;
  /** Optional trailing count, rendered as a muted micro badge. */
  count?: number;
}

/**
 * Segmented switcher — a TRACKLESS row of individual stadium pills: each
 * option is its own hug-width `.seg-pill` (flat gray fill, fully rounded
 * ends), and the active one swaps that face for the kit's `.raised-tab`
 * (the pill radius stays on the button, ring-for-border in both faces so
 * the swap never shifts layout). THE blessed segmented-tabs primitive:
 * any pane that needs scope/filter tabs composes this instead of
 * hand-rolling the pill recipe, so the look stays identical everywhere.
 * No shared track and no sliding thumb — pills hug their labels, so there
 * is no fixed slot geometry for a thumb to travel.
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
  /**
   * Inert while a write this control fires is in flight — a second click
   * during the round trip is a second mutation racing the first, and the
   * loser's rollback restores the winner's optimistic value.
   */
  disabled?: boolean;
  /** Layout-only additions (margins, width) — recipes stay in the kit. */
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
          {count !== undefined && (
            <span className="text-micro text-text-muted">{count}</span>
          )}
        </button>
      ))}
    </div>
  );
}

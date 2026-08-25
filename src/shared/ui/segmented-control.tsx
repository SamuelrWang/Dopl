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
 * hand-roll the pill recipe. Active option is always `.raised-tab`.
 *
 * Two forms, one control:
 * - `"pills"` (default) — TRACKLESS filter row: each option is its own
 *   hug-width `.seg-pill`. ⚠ Radius stays on the button and both faces use
 *   ring-for-border, or the swap shifts layout. No sliding thumb — hugging
 *   pills leave no fixed slot geometry to travel.
 * - `"track"` — the PAGE-HEADER selector (added for /home, 2026-08-24): one
 *   flat `.seg-track` holding the options, inactive ones bare so only the
 *   selected face is raised. Reads a size up, because it names the surface
 *   rather than filtering one.
 *
 * ⚠ `size="lg"` IS THE LANDING NAV'S SCALE AT 6/7, not a free parameter:
 * `marketing.css › .lp-menu-btn` measures 42px tall / 18px side pad / 14px
 * text (2026-08-24), and this is 36 / 15 / 12 — the same 3.0 height-to-text
 * ratio a notch down (Samuel, 2026-08-24), landing on `text-small`, which is
 * the ramp's own "compact buttons" step. Every control in a header that uses it
 * is cut to the same 36px, which is why the two forms take different OPTION
 * heights to land there: trackless, the pill IS the control (36px); tracked,
 * the 3px `.seg-track` pad on each side means 30px options. `"sm"` is the
 * default and the app-wide filter-row scale.
 */
export function SegmentedControl<K extends string>({
  options,
  value,
  onChange,
  disabled,
  variant = "pills",
  size = "sm",
  className,
}: {
  options: ReadonlyArray<SegmentedOption<K>>;
  value: K;
  onChange: (next: K) => void;
  /** ⚠ Set while a write this control fired is in flight: a second click races
   *  the first, and the loser's rollback restores the winner's value. */
  disabled?: boolean;
  /** Trackless filter row (default) or the tracked page-header selector. */
  variant?: "pills" | "track";
  /** Compact filter row (default), or the landing nav's 42px header scale. */
  size?: "sm" | "lg";
  /** Layout-only (margins, width) — plus the track's `bg-*` token in the
   *  `"track"` form, which the kit leaves to the consumer. */
  className?: string;
}) {
  const tracked = variant === "track";
  const option =
    size === "lg"
      ? tracked
        ? "h-[30px] px-[15px] text-small"
        : "h-9 px-[15px] text-small"
      : "h-[27px] px-3 text-caption";
  return (
    <div
      role="tablist"
      className={cn(
        tracked ? "seg-track" : "flex items-center gap-1.5",
        className
      )}
    >
      {options.map(({ key, label, count }) => (
        <button
          key={key}
          type="button"
          role="tab"
          aria-selected={value === key}
          disabled={disabled}
          onClick={() => value !== key && onChange(key)}
          className={cn(
            "flex items-center justify-center gap-1.5 rounded-full font-medium transition-colors",
            option,
            value === key
              ? "raised-tab text-text-primary"
              : cn(
                  "text-text-secondary hover:text-text-primary",
                  !tracked && "seg-pill"
                ),
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

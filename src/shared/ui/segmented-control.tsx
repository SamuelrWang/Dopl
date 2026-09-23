"use client";

import { cn } from "@/shared/lib/utils";

export interface SegmentedOption<K extends string = string> {
  key: K;
  label: string;
  /** Optional trailing count, rendered as a muted micro badge. */
  count?: number;
  /**
   * A muted suffix inside the option: a security signal, not decoration. It carries a foreign
   * identity's authorship marker, shown before the choice is made (INVARIANTS §5A). Inside the
   * button, so it is part of the accessible name. A word or two.
   */
  hint?: string;
}

/**
 * The segmented-tabs primitive — compose it for any scope/filter tab row, never hand-roll the
 * pill recipe. The active option is always `.raised-tab`. Forms:
 * - `"pills"` (default): trackless filter row of hug-width `.seg-pill`s. Radius stays on the
 *   button and both faces draw rings, not borders, so selecting never shifts layout.
 * - `"track"`: the page-header selector, one flat `.seg-track`.
 * - `"underline"`: text only, the current option marked by a black rule.
 * - `"plain"`: `"pills"` without the hairline, for a form's selector.
 * `size="lg"` lands on the 36px header height: trackless the pill is the control; tracked, 30px
 * options + the track's 3px pad.
 */
export function SegmentedControl<K extends string>({
  options,
  value,
  onChange,
  disabled,
  variant = "pills",
  size = "sm",
  className,
  ariaLabel,
  weight,
}: {
  options: ReadonlyArray<SegmentedOption<K>>;
  value: K;
  onChange: (next: K) => void;
  /** Set while a write this control fired is in flight: a second click would race the first,
   *  and the loser's rollback would restore the winner's value. */
  disabled?: boolean;
  /** `"plain"` is a named form, not a `bordered={false}` prop: a boolean that silently changes
   *  one of four faces is harder to read at a call site. */
  variant?: "pills" | "track" | "underline" | "plain";
  /** Compact filter row (default), `"md"` = the `--action-h-sm` token, or the header scale. */
  size?: "sm" | "md" | "lg";
  /** Layout only, plus the track's `bg-*` token in the `"track"` form. */
  className?: string;
  /** Accessible name for the `role="tablist"`; needed wherever a visible word outside the row
   *  labels it, since that text is not attached to the tablist. */
  ariaLabel?: string;
  /** Overrides the form's own weight (the /home page switcher). */
  weight?: "semibold";
}) {
  const tracked = variant === "track";
  const underlined = variant === "underline";
  const plain = variant === "plain";
  // Trackless `lg` takes a 12px side pad, not 15: the channel info column's four-option row
  // with count badges overflows at 15.
  const option = underlined
    ? "relative h-9 px-1 text-small"
    : size === "md"
      ? "h-[var(--action-h-sm)] px-3 text-caption"
      : size === "lg"
        ? tracked
          ? "h-[30px] px-[15px] text-small"
          : "h-9 px-3 text-small"
        : "h-[27px] px-3 text-caption";
  return (
    <div
      role="tablist"
      aria-label={ariaLabel}
      className={cn(
        tracked
          ? "seg-track"
          : underlined
            ? "flex items-center gap-5"
            : "flex items-center gap-1.5",
        className
      )}
    >
      {options.map(({ key, label, count, hint }) => (
        <button
          key={key}
          type="button"
          role="tab"
          aria-selected={value === key}
          disabled={disabled}
          onClick={() => value !== key && onChange(key)}
          className={cn(
            // `plain` pills are regular weight; every other form keeps medium.
            "flex items-center justify-center gap-1.5 transition-colors",
            weight === "semibold"
              ? "font-semibold"
              : variant === "plain"
                ? "font-normal"
                : "font-medium",
            !underlined && "rounded-full",
            option,
            value === key
              ? underlined
                // The underline is the only selected-state mark.
                ? "text-text-primary after:absolute after:inset-x-0 after:bottom-0 after:h-[2px] after:rounded-full after:bg-text-primary"
                : "raised-tab text-text-primary"
              : cn(
                  "text-text-secondary hover:text-text-primary",
                  // `plain` wears `.seg-pill`'s `--seg-fill` gray but not its ring.
                  plain && "bg-[var(--seg-fill)]",
                  !tracked && !underlined && !plain && "seg-pill"
                ),
            disabled ? "cursor-not-allowed opacity-60" : "cursor-pointer"
          )}
        >
          {label}
          {/* Inside the button, so the hint reaches the accessible name. */}
          {hint && <span className="text-micro font-normal text-text-muted">{hint}</span>}
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

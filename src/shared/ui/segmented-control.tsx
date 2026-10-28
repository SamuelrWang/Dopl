"use client";

import { cn } from "@/shared/lib/utils";
import { TabUnderline } from "./tab-underline";

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

/** The tab's and its panel's ids for a row given `panelIdPrefix`. */
export function segmentedIds(prefix: string, key: string): { tab: string; panel: string } {
  return { tab: `${prefix}-tab-${key}`, panel: `${prefix}-panel-${key}` };
}

/**
 * The segmented-tabs primitive — compose it for any scope/filter tab row, never hand-roll the
 * pill recipe. The active option is always `.raised-tab`. Forms:
 * - `"pills"` (default): trackless filter row of hug-width `.seg-pill`s. Radius stays on the
 *   button and both faces draw rings, not borders, so selecting never shifts layout.
 * - `"track"`: the page-header selector, one flat `.seg-track`.
 * - `"underline"`: THE TAB UNDERLINE — text only, the current option marked by
 *   `tab-underline.tsx › TabUnderline`. At `size="lg"` it is the
 *   /home header's tab bar: 13px ink labels that dim on hover. `orientation="vertical"` stacks the
 *   same tabs as a rail (the profile popup's) one type step up, 14px on 32px rows, each hugging
 *   its word so the rule sits under it.
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
  orientation = "horizontal",
  className,
  ariaLabel,
  panelIdPrefix,
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
  /** `"vertical"` is the `underline` form only. */
  orientation?: "horizontal" | "vertical";
  /** Layout only, plus the track's `bg-*` token in the `"track"` form. */
  className?: string;
  /** Accessible name for the `role="tablist"`; needed wherever a visible word outside the row
   *  labels it, since that text is not attached to the tablist. */
  ariaLabel?: string;
  /** When the row switches panels: each tab gets `id` + `aria-controls` from this prefix
   *  ({@link segmentedIds}), and the host gives its panel the matching `role="tabpanel"`. */
  panelIdPrefix?: string;
}) {
  const tracked = variant === "track";
  const underlined = variant === "underline";
  const plain = variant === "plain";
  const tabBar = underlined && size === "lg";
  const vertical = underlined && orientation === "vertical";
  // Trackless `lg` takes a 12px side pad, not 15: the channel info column's four-option row
  // with count badges overflows at 15.
  const option = underlined
    ? tabBar
      ? cn("relative px-0.5", vertical ? "h-8 text-title" : "h-9 text-lead")
      : "relative h-9 px-1 text-small"
    : size === "md"
      ? "h-[var(--action-h-sm)] px-3 text-caption"
      : size === "lg"
        ? tracked
          ? "h-7.5 px-3.75 text-small"
          : "h-9 px-3 text-small"
        : "h-6.75 px-3 text-caption";
  return (
    <div
      role="tablist"
      aria-label={ariaLabel}
      aria-orientation={vertical ? "vertical" : undefined}
      className={cn(
        tracked
          ? "seg-track"
          : vertical
            ? "flex flex-col items-start gap-2"
            : underlined
              ? cn("flex items-center", tabBar ? "gap-5.5" : "gap-5")
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
          {...(panelIdPrefix
            ? {
                id: segmentedIds(panelIdPrefix, key).tab,
                "aria-controls": segmentedIds(panelIdPrefix, key).panel,
              }
            : {})}
          disabled={disabled}
          onClick={() => value !== key && onChange(key)}
          className={cn(
            // `plain` pills are regular weight; every other form keeps medium.
            "flex items-center justify-center gap-1.5",
            tabBar ? "transition-opacity" : "transition-colors",
            plain ? "font-normal" : "font-medium",
            !underlined && "rounded-full",
            option,
            value === key
              ? underlined
                ? "text-text-primary"
                : "raised-tab text-text-primary"
              : cn(
                  tabBar
                    ? "text-text-primary hover:opacity-70"
                    : "text-text-secondary hover:text-text-primary",
                  // `plain` wears `.seg-pill`'s `--seg-fill` gray but not its ring.
                  plain && "bg-[var(--seg-fill)]",
                  !tracked && !underlined && !plain && "seg-pill"
                ),
            disabled ? "cursor-not-allowed opacity-60" : "cursor-pointer"
          )}
        >
          {label}
          {underlined && value === key && <TabUnderline />}
          {/* Inside the button, so the hint reaches the accessible name. */}
          {hint && <span className="text-micro font-normal text-text-muted">{hint}</span>}
          {count !== undefined &&
            (value === key ? (
              <span className="inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-surface-cta px-1.5 text-micro font-semibold text-text-on-cta">
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

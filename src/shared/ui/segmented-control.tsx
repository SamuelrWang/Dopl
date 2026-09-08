"use client";

import { cn } from "@/shared/lib/utils";

export interface SegmentedOption<K extends string = string> {
  key: K;
  label: string;
  /** Optional trailing count, rendered as a muted micro badge. */
  count?: number;
  /**
   * 🔒 A MUTED SUFFIX INSIDE THE OPTION — added 2026-09-08 for the launch
   * dialog's Template row, and it is a SECURITY SIGNAL rather than decoration.
   * INVARIANTS §5A: a foreign template's authorship marker is *"the ONLY signal
   * shown to the human BEFORE the choice is made"*, and that row was a
   * `SelectMenu` whose `MenuItem` carried it as a `description`. A pill row with
   * no slot for it would have dropped the marker on the surface taking the
   * launch traffic.
   * ⚠ IT RIDES INSIDE THE BUTTON, so content-based naming puts it in the
   * option's ACCESSIBLE NAME as well as on its face — the same two places
   * `MenuItem` put it. ⚠ A WORD OR TWO, never a sentence (INVARIANTS §5).
   */
  hint?: string;
}

/**
 * THE segmented-tabs primitive — compose for any scope/filter tab row, never
 * hand-roll the pill recipe. Active option is always `.raised-tab`.
 *
 * FOUR forms, one control (two until 2026-09-08, when `underline` and `plain`
 * landed on the same day for two different Samuel rulings):
 * - `"pills"` (default) — TRACKLESS filter row: each option is its own
 *   hug-width `.seg-pill`. ⚠ Radius stays on the button and both faces use
 *   ring-for-border, or the swap shifts layout. No sliding thumb — hugging
 *   pills leave no fixed slot geometry to travel.
 * - `"track"` — the PAGE-HEADER selector (added for /home, 2026-08-24): one
 *   flat `.seg-track` holding the options, inactive ones bare so only the
 *   selected face is raised. Reads a size up, because it names the surface
 *   rather than filtering one.
 * - `"underline"` — text only, the current option marked by a black rule.
 * - `"plain"` — `"pills"` without the hairline, for a FORM's selector rather
 *   than a filter row (the launch dialog). See the `variant` prop.
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
  ariaLabel,
  weight,
}: {
  options: ReadonlyArray<SegmentedOption<K>>;
  value: K;
  onChange: (next: K) => void;
  /** ⚠ Set while a write this control fired is in flight: a second click races
   *  the first, and the loser's rollback restores the winner's value. */
  disabled?: boolean;
  /**
   * Trackless filter row (default), the tracked page-header selector, the
   * text-only row whose current option wears a black underline (2026-09-08,
   * Samuel: "remove the pills … just the text, and the selected tab will just
   * have a black underline"), or `"plain"`.
   *
   * ⚠ `"plain"` IS `"pills"` MINUS THE HAIRLINE (2026-09-08, Samuel's popup-panel
   * ruling: *"for the unselected items, just have it be a gray background, no
   * additional gray borderline"*). Same geometry, same `--seg-fill` gray, same
   * `.raised-tab` selected face — it drops ONLY `.seg-pill`'s inset ring. It is a
   * fourth variant rather than a `bordered={false}` prop because the two forms
   * are picked by NAME everywhere else in this kit, and a boolean that silently
   * changes one of four faces is the harder one to read at a call site.
   */
  variant?: "pills" | "track" | "underline" | "plain";
  /**
   * Compact filter row (default), the SMALL-ACTION scale, or the landing nav's
   * 42px header scale.
   *
   * ⚠ `"md"` IS `--action-h-sm` — THE TOKEN, NOT A NUMBER (2026-09-08). 30px is
   * the height `open-scale-button.module.css › .openScale` and the channels
   * composer's Launch / Discard already read, and Samuel asked the launch
   * dialog's selectors to *"make the dimensions that of the 30px"*. Reading the
   * same token is what keeps a fourth face from drifting off the other three.
   */
  size?: "sm" | "md" | "lg";
  /** Layout-only (margins, width) — plus the track's `bg-*` token in the
   *  `"track"` form, which the kit leaves to the consumer. */
  className?: string;
  /** Accessible name for the `role="tablist"`. ⚠ Needed wherever a VISIBLE word
   *  labels the row from outside it (the launch dialog's three selectors): that
   *  text is not attached to the tablist, so without this the group is unnamed.
   *  A row that IS the page's only switcher does not need one. */
  ariaLabel?: string;
  /** `"semibold"` overrides the form's own weight — the /home page switcher
   *  (Samuel, 2026-09-08: "the switcher pills at the top, the text should be
   *  bolded"); a `plain` FORM row stays regular. */
  weight?: "semibold";
}) {
  const tracked = variant === "track";
  const underlined = variant === "underline";
  const plain = variant === "plain";
  const option = underlined
    ? "relative h-9 px-1 text-small"
    : size === "md"
      // ⚠ THE TOKEN, so this face cannot drift off the other three 30px controls.
      ? "h-[var(--action-h-sm)] px-3 text-caption"
      :
    size === "lg"
      ? tracked
        ? "h-[30px] px-[15px] text-small"
        // ⚠ TRACKLESS `lg` TAKES THE TIGHTER SIDE PAD, and it is a width budget rather than a
        // taste: this form is the channel info column's Info / Threads N / Agents N / Settings
        // row, four options with two count badges inside 380px minus the header's padding
        // (the column was 340px when this was measured; 2026-08-25 widened it, so the
        // budget has HEADROOM now and the value is unchanged — 12px is also the ramp's
        // own "compact buttons" step, which is the reason it stays rather than the fit).
        // At 15px a side they overflow; at 12px they fit with room. The height — the 36px every
        // control on these surfaces shares — is what Samuel asked to match, and it is unchanged.
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
            // ⚠ `plain` pills are REGULAR weight (Samuel, 2026-09-08: "The text inside
            // the pills should not be bolded"); every other form keeps medium.
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
                // The underline is the ONLY selected-state mark: 2px, ink
                // colour, flush with the row's bottom edge.
                ? "text-text-primary after:absolute after:inset-x-0 after:bottom-0 after:h-[2px] after:rounded-full after:bg-text-primary"
                : "raised-tab text-text-primary"
              : cn(
                  "text-text-secondary hover:text-text-primary",
                  // ⚠ `plain` WEARS `.seg-pill`'s FILL AND NOT ITS RING. The gray
                  // is read through the SAME `--seg-fill` variable the pill and
                  // the track read, so the borderless face cannot drift to a
                  // second gray — what is dropped is the hairline, nothing else.
                  plain && "bg-[var(--seg-fill)]",
                  !tracked && !underlined && !plain && "seg-pill"
                ),
            disabled ? "cursor-not-allowed opacity-60" : "cursor-pointer"
          )}
        >
          {label}
          {/* 🔒 INSIDE the button, so it reaches the accessible name — see the
              field's docblock on {@link SegmentedOption}. */}
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

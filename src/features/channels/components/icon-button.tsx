"use client";

/**
 * THE ONE CHROME ICON CONTROL — every header's quiet square button, and (with
 * `active`) the app's one icon TOGGLE face.
 *
 * §1 SPLIT (2026-08-25). It lived in `bits.tsx`, which sat at EXACTLY 499 lines
 * with one line of headroom; adding the `bare` variant Samuel's right-pane
 * toggle needs pushed it to 516, and §1 is explicit that an edit to an over-cap
 * file either splits it or shrinks it. The reflex alternative is deleting a
 * comment — which is how eight files in this tree converged on the same two
 * numbers — so this takes the real seam instead.
 *
 * ⚠ AND IT IS A REAL SEAM, not a line-count dodge. `bits.tsx` is "the small
 * pieces the three columns share" and is Channels-shaped; this control is not:
 * `features/members/components/members-v2/bits.tsx` has its OWN copy of the
 * same idea, and this file is where the two would one day converge. It has one
 * reason to change (what a chrome icon control looks like) and that reason is
 * now visibly its own.
 *
 * ⚠ `bits.tsx` RE-EXPORTS IT, so every existing `from "./bits"` importer is
 * unchanged — the same contract `main/session-io.js` keeps over
 * `› session-post-surface.js`.
 */

import type { LucideIcon } from "lucide-react";
import { cn } from "@/shared/lib/utils";

/**
 * Quiet square icon button — the one chrome affordance in every header, and
 * (with `active`) the one TOGGLE face.
 *
 * `active` wears `.raised-tab`, the app-wide selected face. Its resting hover
 * tint is on the NOT-active branch on purpose: `.raised-tab` supplies the fill
 * from `@layer components`, so an unconditional `hover:bg-*` from the utility
 * layer would flatten the gradient the moment the cursor crossed it
 * (docs/DESIGN-SYSTEM.md § `.raised-tab`).
 *
 * ⚠ `bare` IS THE ABSENCE OF ALL OF THAT (Samuel, 2026-08-25) — see the prop.
 */
export function IconButton({
  icon: Icon,
  label,
  size = 15,
  active,
  filled,
  disabled,
  bare,
  onClick,
  className,
}: {
  icon: LucideIcon;
  label: string;
  size?: number;
  /** Omit for a plain button; pass a boolean to make it a toggle. */
  active?: boolean;
  /**
   * FILL the glyph. Separate from `active` on purpose: `active` is a CHROME
   * state (this control's surface is raised), `filled` is a claim about the
   * THING the glyph stands for — a filled bookmark reads as saved. The outline
   * is always drawn, so the glyph does not change size between states, which is
   * the same rule the knowledge card's bookmark follows
   * (`knowledge-v2/home/base-card.tsx`).
   */
  filled?: boolean;
  /**
   * ⚠ IN FLIGHT, not "not allowed" (2026-08-21, the composer's New Agent icon).
   * A control this surface cannot offer at all is not RENDERED — that is the
   * feature-detection rule the whole bridge family follows, and a permanently
   * greyed glyph is indistinguishable from a broken one. This is for the moment
   * between a click and its answer.
   */
  disabled?: boolean;
  /**
   * NO BUTTON FACE AT ALL — a naked glyph (Samuel, 2026-08-25).
   * ⚠ IT SUPPRESSES THE `active` RAISE AS WELL AS THE RESTING SURFACE, which is
   * the half that is easy to miss: `.raised-tab` is a FILL, so a "bare" control
   * that still raised when pressed grows a button face on exactly the state the
   * operator sits in. The colour shift is the whole affordance either way, and
   * `aria-pressed` still carries the state — nothing is lost but paint.
   * ⚠ THE HIT AREA GROWS RATHER THAN SHRINKS: 32px, not the chrome face's 28px.
   * Removing the surface removes the visual target, so the touchable one must
   * not go with it (32px is what /home's deleted circle gave this control).
   */
  bare?: boolean;
  onClick?: () => void;
  className?: string;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      aria-pressed={active}
      disabled={disabled}
      onClick={onClick}
      className={cn(
        "flex shrink-0 items-center justify-center transition-colors",
        bare ? "h-8 w-8" : "h-7 w-7 rounded-[7px]",
        active && "text-text-primary",
        active && !bare && "raised-tab",
        !active && "text-text-secondary hover:text-text-primary",
        !active && !bare && "hover:bg-surface-raised-1",
        disabled && "cursor-not-allowed opacity-50",
        className
      )}
    >
      <Icon size={size} fill={filled ? "currentColor" : "none"} />
    </button>
  );
}

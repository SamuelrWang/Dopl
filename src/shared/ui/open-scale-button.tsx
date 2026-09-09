"use client";

import type { ButtonHTMLAttributes } from "react";
import { cn } from "@/shared/lib/utils";
import styles from "./open-scale-button.module.css";

/**
 * THE SMALL PILL BUTTON — `--action-h-sm` (30px since 2026-09-08),
 * `.btn-light` face, stadium ends.
 *
 * ⚠ ONE SOURCE, EVERY SURFACE (Samuel, 2026-08-28: every /home button wearing
 * the small create-button recipe adopts the KB card Open button's size/UI). The
 * face was `knowledge-v2.module.css › .cardOpen` plus a hand-written
 * `h-6 … px-2.5 text-caption` copied verbatim into two /home files; all of it
 * moved into `open-scale-button.module.css`, which is imported HERE and nowhere
 * else, so `.openScale` is one rule with one owner.
 *
 * ⚠ IT IS THE FACE AND THE SCALE, NOTHING ELSE. Layout and behavioural states
 * (a caller's own `disabled:opacity-60`) stay with the caller through
 * `className` — the same division `wells.ts` holds for the text controls.
 * Children are the caller's, so an icon is opt-in; size it with
 * `OPEN_SCALE_ICON` rather than restating 12.
 */
export function OpenScaleButton({
  className,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button type="button" {...props} className={cn("btn-light", styles.openScale, className)} />
  );
}

/**
 * THE SAME PILL, GLYPH ONLY — `OpenScaleButton` plus a fixed width (2026-08-28).
 *
 * ⚠ **IT WAS 1:1 UNTIL 2026-09-08 AND IS NOT ANY MORE.** The pill's height is
 * `--action-h-sm` (30px) and `.openScaleIcon`'s width is still the literal 26px
 * the pill used to be, so the square is 26×30. Left alone on purpose — Samuel
 * ruled the small ACTION height, not the toolbar glyph's box; the CSS module
 * carries the same note at the rule.
 *
 * ⚠ NOT A SECOND FACE. It composes the very same `.openScale` rule and adds a
 * square (`.openScaleIcon`), so an edit to the pill's height, radius, elevation
 * or ink reaches both. `aria-label` is required — a control with no text has no
 * other name. Behavioural states stay with the caller through `className` (the
 * delete control's `hover:text-danger`), as on the labelled pill.
 */
export function OpenScaleIconButton({
  className,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { "aria-label": string }) {
  return (
    <OpenScaleButton {...props} className={cn(styles.openScaleIcon, className)} />
  );
}

/** Glyph size inside the pill — the card Open's `ArrowRight`, and now the
 *  /home create buttons' `Plus`. ONE number: two icons at two sizes in the same
 *  pill is the drift in miniature. */
export const OPEN_SCALE_ICON = 12;

/** Glyph size for the SQUARE variant. Bigger than `OPEN_SCALE_ICON` because it
 *  is alone in the pill — a 12px mark in a 26px square with no label beside it
 *  reads as a speck, and the labelled pill's 12 is sized against its text. */
export const OPEN_SCALE_ICON_ONLY = 14;

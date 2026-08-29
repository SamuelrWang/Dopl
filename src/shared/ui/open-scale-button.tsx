"use client";

import type { ButtonHTMLAttributes } from "react";
import { cn } from "@/shared/lib/utils";
import styles from "./open-scale-button.module.css";

/**
 * THE SMALL PILL BUTTON — 26px, `.btn-light` face, stadium ends.
 *
 * ⚠ ONE SOURCE, TWO SURFACES (Samuel, 2026-08-28: every /home button wearing
 * the small create-button recipe adopts the KB card Open button's size/UI).
 * The face was `knowledge-v2.module.css › .cardOpen`, private to the knowledge
 * card, while /home's section buttons carried a hand-written
 * `h-6 … px-2.5 text-caption` recipe DUPLICATED VERBATIM in two files. Both are
 * gone: the declarations moved to `open-scale-button.module.css` and every
 * caller — the card's own Open included — renders this component, so the card
 * and the /home buttons cannot drift apart by an edit to either one.
 *
 * ⚠ IT IS THE FACE AND THE SCALE, NOTHING ELSE. Layout beyond the pill's own
 * inline row, and behavioural states (the `disabled:opacity-60` a caller
 * already had), stay with the caller through `className` — the same division
 * `wells.ts` holds for the text controls.
 *
 * Children are the caller's, so an icon is opt-in; size it with
 * `OPEN_SCALE_ICON` rather than restating 12.
 */
export function OpenScaleButton({
  className,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      type="button"
      {...props}
      className={cn("btn-light", styles.openScale, className)}
    />
  );
}

/**
 * THE SAME PILL, GLYPH ONLY — `OpenScaleButton` at 1:1 (2026-08-28).
 *
 * ⚠ NOT A SECOND FACE. It composes the very same `.openScale` rule and adds a
 * square (`.openScaleIcon`), so a toolbar glyph and a labelled create button
 * cannot drift: an edit to the pill's height, radius, elevation or ink reaches
 * both. `aria-label` is required — a control with no text has no other name.
 *
 * ⚠ IT REPLACED A FILE-PRIVATE STRING, which is the point. The knowledge base
 * header carried its own `ICON_BTN` (a bare 28px hover tint), one of six
 * hand-written copies of that recipe in `src/`. Behavioural states stay with
 * the caller through `className` — the delete control's `hover:text-danger` is
 * the caller's, exactly as `disabled:opacity-60` is on the labelled pill.
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
 *  26px pill is the drift in miniature. */
export const OPEN_SCALE_ICON = 12;

/** Glyph size for the SQUARE variant. Bigger than `OPEN_SCALE_ICON` because it
 *  is alone in the pill — a 12px mark in a 26px square with no label beside it
 *  reads as a speck, and the labelled pill's 12 is sized against its text. */
export const OPEN_SCALE_ICON_ONLY = 14;

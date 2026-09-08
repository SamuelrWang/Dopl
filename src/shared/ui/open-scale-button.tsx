"use client";

import type { ButtonHTMLAttributes } from "react";
import { cn } from "@/shared/lib/utils";
import styles from "./open-scale-button.module.css";

/**
 * THE SMALL PILL BUTTON — `--action-h-sm` (30px since 2026-09-08),
 * `.btn-light` face, stadium ends.
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
  return <button type="button" {...props} className={cn(OPEN_SCALE, className)} />;
}

/**
 * THE PILL AS A CLASS STRING — for a caller that already owns its `<button>`
 * and cannot swap the element for {@link OpenScaleButton}.
 *
 * ⚠ IT IS THE SAME DECLARATION, NOT A SECOND ONE. `OpenScaleButton` renders
 * this constant, so the component and the string cannot drift; the CSS module
 * is imported HERE and nowhere else, which is what keeps `.openScale` a single
 * rule with a single owner. Reach for the COMPONENT first — this exists for
 * `channels-v2/bits.tsx › CARD_BUTTON`, whose seven call sites are plain
 * `<button className={…}>` in five files.
 */
export const OPEN_SCALE = cn("btn-light", styles.openScale);

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
 *  pill is the drift in miniature. */
export const OPEN_SCALE_ICON = 12;

/** Glyph size for the SQUARE variant. Bigger than `OPEN_SCALE_ICON` because it
 *  is alone in the pill — a 12px mark in a 26px square with no label beside it
 *  reads as a speck, and the labelled pill's 12 is sized against its text. */
export const OPEN_SCALE_ICON_ONLY = 14;

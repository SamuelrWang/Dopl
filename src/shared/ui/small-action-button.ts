/**
 * THE 30px FLAT TEXT BUTTON — `--action-h-sm`, no face at rest, a raised-1 tint on hover.
 *
 * ⚠ ONE DECLARATION, THREE SURFACES. It was written out three times — the composer card's
 * Discard (`channels/components/composer-toolbar.tsx`), every popup form's Discard
 * (`shared/ui/form-dialog.tsx`), and the panel card action (`channels/components/bits.tsx ›
 * CARD_BUTTON`, text-only since 2026-09-08) — so an edit to the hover ink or the scale
 * reached one of the three. Extend it through `cn`, never by re-typing it.
 *
 * ⚠ THE SCALE IS THE TOKEN, NOT A 30. `--action-h-sm` is the small-action height every
 * control inside a popup form and along the composer's bottom row reads
 * (docs/DESIGN-SYSTEM.md); the 36px scale belongs to the PAGE buttons that open one
 * (`channels/components/bits.tsx › TAB_ACTION`).
 */
export const SMALL_TEXT_BUTTON =
  "flex h-[var(--action-h-sm)] items-center rounded-[8px] px-2.5 text-caption font-medium " +
  "text-text-secondary transition-colors hover:bg-surface-raised-1 hover:text-text-primary";

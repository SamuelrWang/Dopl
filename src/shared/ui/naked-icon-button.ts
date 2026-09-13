/**
 * THE NAKED ICON BUTTON — a glyph with a hit area and **no button face at all**:
 * no border, no fill, no shadow, in any state. Muted ink, primary on hover, and
 * the 30px box is made of PADDING alone.
 *
 * 🔒 **SAMUEL'S RULING, 2026-09-12, over the ontology object panel** (*"for the
 * trash and X buttons, just have it be naked icons, no more button UI"*) — and
 * the same face the /home Usage card's month arrows wear (2026-09-13). It lived
 * as a file-private `NAKED_ICON_BUTTON` in
 * `features/ontology/components/object-panel.tsx` until the second surface
 * needed it; it is here rather than copied because **`docs/DESIGN-SYSTEM.md`'s
 * F-345 names a hand-written icon-button string repeated per file as the debt
 * this product already has six of. A seventh is forbidden by name.**
 *
 * ⚠ **NOT `OpenScaleIconButton`** (`open-scale-button.tsx`), which is the small
 * PILL with `.btn-light` elevation. That one is a button that happens to hold a
 * glyph; this is a glyph that happens to be clickable. The two are alternatives,
 * never layers.
 *
 * ⚠ **A `.ts` CONSTANTS MODULE, NOT A COMPONENT.** Behavioural state
 * (`disabled:`), layout and the `aria-label` stay with the caller — the same
 * division `panel-buttons.tsx › PAGE_ACTION_BTN` holds. A control with no text
 * has no name but its `aria-label`, so every caller must pass one.
 */
export const NAKED_ICON_BUTTON =
  "flex shrink-0 items-center justify-center rounded-[8px] p-2 " +
  "text-text-muted transition-colors hover:text-text-primary";

/** The glyph inside it — the size the ontology board header's gear wears. ONE
 *  number: two glyphs at two sizes in the same face is the drift in miniature. */
export const NAKED_ICON = 14;

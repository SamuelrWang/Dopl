"use client";

/**
 * A TEXTAREA THAT IS ONE LINE UNTIL IT IS NOT — the composer's auto-grow, extracted (2026-08-27,
 * Samuel's launch-panel refinements).
 *
 * ⚠ EXTRACTED, NOT REIMPLEMENTED. It was written inline in `composer.tsx` for the chat draft
 * (2026-08-20 — the second line was clipping invisibly at `rows={1}`), and the panels' Description
 * fields want exactly the same behaviour. A second copy is how one of them ends up growing to a
 * different ceiling than the other, which reads as a bug in whichever the reader met second.
 *
 * ⚠ A STYLE MUTATION IN AN EFFECT, NOT STATE. The height is derived from content the DOM already
 * holds; a state copy would re-render the whole composer on every keystroke for a number only the
 * element needs.
 *
 * ⚠ `height = "auto"` FIRST, EVERY TIME. `scrollHeight` never shrinks below the element's current
 * height, so without the reset a field that grew to three lines can never come back down when the
 * text is deleted.
 *
 * ⚠ jsdom REPORTS `scrollHeight` AS 0, which makes the whole effect a harmless no-op under test —
 * that is why nothing here is pinned by a height assertion, and why `next > 0` guards the write.
 */

import { useEffect, type RefObject } from "react";

/** Grow `ref` to fit its content, up to `maxLines`, then scroll inside. */
export function useAutoGrow(
  ref: RefObject<HTMLTextAreaElement | null>,
  /** Re-measured whenever this changes — the field's current value. */
  value: string,
  /** The ceiling, in lines. Past it the field scrolls rather than growing. */
  maxLines = 3
): void {
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    const line = Number.parseFloat(getComputedStyle(el).lineHeight) || 20;
    const max = Math.ceil(line * maxLines) + 8;
    const next = Math.min(el.scrollHeight, max);
    if (next > 0) el.style.height = `${next}px`;
    el.style.overflowY = el.scrollHeight > max ? "auto" : "hidden";
  }, [ref, value, maxLines]);
}

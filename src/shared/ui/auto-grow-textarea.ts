"use client";

/**
 * Composer auto-grow: grows to exactly `maxLines` line-heights, then scrolls.
 * Math is pure so it is testable without a DOM.
 *
 * ⚠ THE "KEEP IN SYNC WITH `renderer/session/session-chrome.js › growHeight`"
 * INSTRUCTION IS RETIRED (2026-08-20). That tree was deleted with the v1 session
 * window, so the instruction pointed at nothing while still reading as an active
 * obligation — the worst shape a comment can take, because a reader either hunts
 * for a file that is gone or assumes a twin exists and edits only one side.
 * **THIS IS THE ONLY IMPLEMENTATION NOW.**
 */

import { useCallback, useLayoutEffect, useRef, type RefObject } from "react";

/** Session window's cap: three lines, then scroll. */
export const MAX_COMPOSER_LINES = 3;

function num(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

/**
 * Next height in px. `padding` is in both scrollHeight and the border-box
 * height, so it rides INSIDE the clamp. Degenerate line-height falls back to raw
 * scrollHeight. ⚠ Verbatim port of session-chrome.growHeight — both must agree.
 */
export function growHeight(
  scrollHeight: number,
  lineHeight: number,
  maxLines: number,
  padding: number
): number {
  const lh = num(lineHeight);
  const sh = Math.max(0, num(scrollHeight));
  if (lh <= 0) return sh;
  const pad = Math.max(0, num(padding));
  const lines = Math.max(1, Math.floor(num(maxLines) || MAX_COMPOSER_LINES));
  return Math.max(lh + pad, Math.min(sh, lh * lines + pad));
}

/** Height recomputes on mount and every `value` change. useLayoutEffect so the
 *  resize lands in the same frame as the text. */
export function useAutoGrowTextarea(
  value: string,
  maxLines: number = MAX_COMPOSER_LINES
): RefObject<HTMLTextAreaElement | null> {
  const ref = useRef<HTMLTextAreaElement | null>(null);

  const resize = useCallback(() => {
    const node = ref.current;
    if (!node || typeof window === "undefined") return;
    const cs = window.getComputedStyle(node);
    const pad =
      (parseFloat(cs.paddingTop) || 0) + (parseFloat(cs.paddingBottom) || 0);
    node.style.height = "auto"; // lets scrollHeight shrink back on delete
    node.style.height =
      growHeight(node.scrollHeight, parseFloat(cs.lineHeight), maxLines, pad) + "px";
  }, [maxLines]);

  useLayoutEffect(() => {
    resize();
  }, [resize, value]);

  return ref;
}

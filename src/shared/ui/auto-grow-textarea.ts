"use client";

/**
 * Composer auto-grow — the web twin of the desktop session window's D7 behavior
 * (renderer/session/session-chrome.js `growHeight` + session.js `autoGrow`).
 *
 * The field starts one line tall, grows with the typed content up to exactly
 * `maxLines` line-heights, and then STAYS there and scrolls. The math is a pure
 * function so it is unit-testable without a DOM; the hook only measures the real
 * computed line-height + vertical padding and applies the returned px height.
 */

import { useCallback, useLayoutEffect, useRef, type RefObject } from "react";

/** The session window's cap: three lines, then scroll. */
export const MAX_COMPOSER_LINES = 3;

function num(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

/**
 * The next height in px. `padding` is the textarea's vertical padding, which is
 * part of both scrollHeight and the border-box height, so it rides inside the
 * clamp. A degenerate line-height falls back to the raw scrollHeight.
 *
 * Ported verbatim from session-chrome.growHeight so both composers agree.
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

/**
 * Attach to a textarea to make it auto-grow. Returns the ref to spread onto the
 * element; the height is recomputed on every `value` change (which covers typing,
 * paste, programmatic clears after a send, and prop-driven resets) and on mount.
 *
 * useLayoutEffect so the resize lands in the same frame as the text — the field
 * never flashes at the wrong height.
 */
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
    node.style.height = "auto"; // let scrollHeight shrink back when text is deleted
    node.style.height =
      growHeight(node.scrollHeight, parseFloat(cs.lineHeight), maxLines, pad) + "px";
  }, [maxLines]);

  useLayoutEffect(() => {
    resize();
  }, [resize, value]);

  return ref;
}

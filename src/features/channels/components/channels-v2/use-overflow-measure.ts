"use client";

/**
 * Channels v2 — THE BOUNDED-CONTAINER MEASUREMENT, once (extracted 2026-09-06
 * from the two hand-copies the wave's code review found: `agent-stream-sent-box.tsx
 * › SentBody` (A1, task 10 #1058/#1059) and `artifact-card.tsx › FoldedRun` (A4)).
 *
 * ⚠ **IT OWNS THE MECHANISM, NOT THE CARD.** What is shared here is the ANSWER to
 * "is this content taller than its bound" and the disclosure state that rides on
 * it. Every constant, every label, and the clip-box markup itself stay in the two
 * callers — that is `artifact-card.tsx`'s own ruling (its :24 docblock), and it
 * still holds: the two cards are free to move apart, and neither is pinned to the
 * other's export list. Extracting the measurement does not re-open that.
 *
 * ⚠ IT IS A MEASUREMENT, BECAUSE CSS CANNOT ANSWER THE QUESTION. A `max-height`
 * gives no signal about whether it clipped anything, so a control rendered off the
 * CSS alone would sit under every two-line card promising more and delivering
 * nothing.
 *
 * ⚠ **THE OBSERVER WATCHES THE INNER CONTENT, NEVER THE CLIP BOX.** Observing the
 * wrapper feeds its own resize back into the measurement that resized it; the
 * inner node's height is the natural height, which is the only number the
 * comparison wants.
 *
 * ⚠ IT MEASURES ONLY WHILE COLLAPSED, ON PURPOSE. Expanded, the clip box has no
 * cap and `scrollHeight === clientHeight` — re-running the test there would prove
 * the content fits and pull "Show less" out from under the reader's cursor. The
 * last collapsed verdict stands until it collapses again. Sticky is not permanent:
 * collapsing re-opens the question, which is the state where it is answerable.
 */

import { useCallback, useEffect, useId, useRef, useState } from "react";

export function useOverflowMeasure({
  enabled = true,
  remeasureOn,
}: {
  /**
   * Whether the bound applies at all. `false` renders the content whole and asks
   * nothing — the sent box's held drafts, which must never be folded away under
   * the button asking to post them.
   */
  enabled?: boolean;
  /**
   * ⚠ **THE RE-MEASURE TRIGGER IS THE CALLER'S, AND THE TWO CALLERS DISAGREE ON
   * PURPOSE** (recorded in the wave's review as a correct divergence, not drift).
   * A sent body GROWS as the agent streams it, so its trigger is the `text`; a
   * folded run gains whole MEMBERS, so its trigger is `members.length`. Either
   * way it re-measures where `ResizeObserver` is absent (jsdom, old hosts), which
   * is why it is a dependency and not dead weight — and why this hook takes it
   * rather than guessing which of the two a card meant.
   */
  remeasureOn: unknown;
}) {
  const [open, setOpen] = useState(false);
  const [overflows, setOverflows] = useState(false);
  const clipRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const boxId = useId();

  const measure = useCallback(() => {
    const clip = clipRef.current;
    const content = contentRef.current;
    if (!clip || !content) return;
    // ⚠ A PIXEL OF SLACK: sub-pixel line boxes make an exactly-fitting body read
    // as one pixel too tall, and a control with nothing behind it is the failure
    // this measurement exists to avoid.
    setOverflows(content.scrollHeight - clip.clientHeight > 1);
  }, []);

  useEffect(() => {
    if (!enabled || open) return;
    measure();
    const content = contentRef.current;
    if (!content || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    observer.observe(content);
    return () => observer.disconnect();
  }, [enabled, open, measure, remeasureOn]);

  return { open, setOpen, overflows, clipRef, contentRef, boxId };
}

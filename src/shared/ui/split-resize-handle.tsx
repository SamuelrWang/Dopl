"use client";

/**
 * THE GRAB HANDLE ON A DRAGGABLE DIVIDER — a black pill, flanked by arrows on
 * hover/focus (Samuel, 2026-09-13: *"a vertical black line … a little thick,
 * rounded at the edges, and centered. If I hover over it, it should show the left
 * and right arrows."*). Extracted 2026-09-29 from
 * `channels/components/info-resize-handle.tsx` so the knowledge rail's divider is
 * the SAME component; the mechanism is `./use-split-resize.ts`.
 *
 * ⚠ **IT OCCUPIES NO WIDTH, WHICH IS WHY IT IS A SIBLING OF BOTH COLUMNS.** The
 * wrapper is `w-0`, so the row's box math is unchanged; the pill and the 12px hit
 * strip are absolutely positioned out of that zero-width track, straddling the
 * divider. It carries the ref (`attach`), and its parent is the row.
 *
 * ⚠ **`z-[2]` IS BETWEEN TWO EXISTING LAYERS** on the channels surface (info
 * column `z-index: 1`, agent overlay `z-20`) — above a column's own border, below
 * an overlay that covers the column it would resize.
 */

import { useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { cn } from "@/shared/lib/utils";
import type { SplitResize } from "./use-split-resize";

/**
 * HOW WIDE THE DIVIDER LINE IS, SO THE PILL SITS ON ITS CENTRE (Samuel,
 * 2026-09-13: *"I want it to be perfectly on the vertical line."*).
 *
 * The divider is a `border-l border-border-default` drawn INSIDE the column to the
 * handle's right, so its centre is half a border right of the wrapper's x. It is
 * 1px on the plain kit and 2px under `data-frame-skin`, which widens every
 * `.border-l.border-border-default` AND declares this variable in the adjacent rule
 * (`src/app/globals.css` + the desktop `kit.css` copy) — so the two cannot drift.
 */
export const DIVIDER_WIDTH_VAR = "--channel-divider-w";

/**
 * `left` for the 12px hit strip: half the divider. ⚠ **A LITERAL, NOT
 * INTERPOLATED** from {@link DIVIDER_WIDTH_VAR} — Tailwind scans SOURCE TEXT, so a
 * template literal is a class the generator never sees.
 */
const STRIP_LEFT = "left-[calc(var(--channel-divider-w,1px)/2)]";

/**
 * THE PILL'S FACE — fully rounded, token black. Shared BY REFERENCE with the KB
 * editor's table-edge handle (`shared/editor/table-view.ts`), which sizes it
 * to one cell's edge instead of this divider's 4px × 40px.
 */
export const RESIZE_PILL_CLASS = "shrink-0 rounded-full bg-text-primary";

/** 12px chevrons flanking a 4px pill. */
const ARROW_ICON = 12;

export function SplitResizeHandle({
  resize,
  label,
}: {
  resize: SplitResize;
  /** The separator's accessible name. */
  label: string;
}) {
  const { width, min, max, dragging, attach, onPointerDown, onKeyDown } =
    resize;
  // ⚠ HOVER IS STATE, NOT `group-hover:`, so the arrows are a fact in the DOM.
  // FOCUS shows them too — the keyboard path says "slider" as plainly.
  const [showArrows, setShowArrows] = useState(false);
  const arrows = showArrows || dragging;

  return (
    <div ref={attach} className="relative z-[2] w-0 shrink-0">
      <div
        role="separator"
        aria-orientation="vertical"
        aria-label={label}
        aria-valuenow={width}
        aria-valuemin={min}
        aria-valuemax={max}
        tabIndex={0}
        data-dragging={dragging || undefined}
        onPointerDown={onPointerDown}
        onKeyDown={onKeyDown}
        onPointerEnter={() => setShowArrows(true)}
        onPointerLeave={() => setShowArrows(false)}
        onFocus={() => setShowArrows(true)}
        onBlur={() => setShowArrows(false)}
        // `touch-none` so a drag is a drag and not a scroll; no focus RING — the
        // arrows are this control's focus signal.
        className={cn(
          "absolute inset-y-0 w-3 -translate-x-1/2 cursor-col-resize touch-none outline-none",
          // ⚠ HALF A DIVIDER RIGHT OF THE EDGE, never `left-1/2` (0 on a `w-0`).
          STRIP_LEFT
        )}
      >
        <span className="pointer-events-none absolute left-1/2 top-1/2 flex -translate-x-1/2 -translate-y-1/2 items-center gap-0.5">
          {arrows && (
            <ChevronLeft
              aria-hidden
              data-resize-arrow="left"
              size={ARROW_ICON}
              className="shrink-0 text-text-secondary"
            />
          )}
          {/* THE PILL — 4px × 40px, fully rounded, token black. */}
          <span
            data-resize-pill=""
            className={cn("h-10 w-1", RESIZE_PILL_CLASS)}
          />
          {arrows && (
            <ChevronRight
              aria-hidden
              data-resize-arrow="right"
              size={ARROW_ICON}
              className="shrink-0 text-text-secondary"
            />
          )}
        </span>
      </div>
    </div>
  );
}

"use client";

/**
 * THE GRAB HANDLE ON THE DIVIDER between the transcript and the info column
 * (Samuel, 2026-09-13): *"a vertical black line … a little thick, rounded at the
 * edges, and centered. If I hover over it, it should show the left and right
 * arrows."*
 *
 * ⚠ **IT OCCUPIES NO WIDTH, WHICH IS THE WHOLE REASON IT IS A SIBLING AND NOT A
 * CHILD OF EITHER COLUMN.** The wrapper is `w-0`, so the surface row's box math is
 * byte-for-byte what it was — including the min-content floor that keeps the info
 * pane at its width when the desktop window narrows
 * (`channel-surface-standalone.tsx`'s root docblock owns that rule). The pill and
 * the chevrons are absolutely positioned out of that zero-width track, straddling
 * the divider, and the 12px hit strip is centred on it the same way. A handle
 * INSIDE the slide shell could not do this: that shell is `overflow: hidden`, so
 * the left half of a centred pill would be clipped away.
 *
 * ⚠ **THE WRAPPER CARRIES THE REF, AND ITS PARENT IS THE SURFACE ROOT** — see
 * `use-info-resize.ts`, which owns every rule about the width itself.
 *
 * ⚠ **`z-[2]` IS BETWEEN TWO EXISTING LAYERS, NOT ABOVE THEM.** The info column is
 * `z-index: 1` (`.channel-info-slide`) and the agent overlay is `z-20`
 * (`agent-panel.tsx`) — the handle has to beat the column's own border and must
 * NOT beat an open agent view, which covers the column it would resize.
 */

import { useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { cn } from "@/shared/lib/utils";
import { useInfoResize } from "./use-info-resize";

/** The separator's accessible name. Exported so the suites name it once. */
export const INFO_RESIZE_LABEL = "Resize channel info";

/**
 * HOW WIDE THE DIVIDER LINE IS, SO THE PILL CAN SIT ON ITS CENTRE (Samuel,
 * 2026-09-13: *"right now it's sitting to the left. I want it to be perfectly on
 * the vertical line."*).
 *
 * ⚠ **THE OFFSET IS HALF A BORDER, AND THAT IS THE WHOLE BUG.** The wrapper is
 * `w-0`, so `left-1/2` resolves to 0 and a `-translate-x-1/2` strip centres on
 * the wrapper's own x — which is the info column's LEFT EDGE, i.e. the divider's
 * first pixel, not its middle. The divider is `info-panel.tsx`'s
 * `border-l border-border-default`, drawn INSIDE the column, so its centre is
 * `borderWidth / 2` to the RIGHT of that edge. Shifting the strip by exactly
 * that much puts the 4px pill's centre on the line's centre.
 *
 * ⚠ **AND THE BORDER IS NOT ONE WIDTH ON EVERY HOST, WHICH IS WHY THIS IS A
 * VARIABLE AND NOT A NUMBER.** Where the account palette skin is not worn — the
 * guest web lane — it is the kit hairline (1px, the fallback here); a host
 * wearing `data-frame-skin` (`src/app/globals.css` › THE ACCOUNT PALETTE SKIN)
 * widens exactly that shape to 2px and declares this variable in the ADJACENT
 * rule, so the two cannot drift. A literal `1px` would leave the pill a pixel
 * left of a 2px line, which is the report.
 */
export const DIVIDER_WIDTH_VAR = "--channel-divider-w";

/**
 * `left` for the 12px hit strip: half the divider, so its centre lands on the
 * line's centre once `-translate-x-1/2` has pulled it back.
 *
 * ⚠ **WRITTEN OUT AS A LITERAL, NOT INTERPOLATED FROM {@link DIVIDER_WIDTH_VAR}.**
 * Tailwind scans SOURCE TEXT for class names, so a template literal produces a
 * class the generator never sees and the rule is simply absent at runtime — the
 * pill would then sit at `left: 0` with no error anywhere.
 */
const STRIP_LEFT = "left-[calc(var(--channel-divider-w,1px)/2)]";

/** 12px, the chevron step the info column already uses — it flanks a 4px pill,
 *  and 12 is the icon ramp's step below the 13 a text-scale chevron takes. */
const ARROW_ICON = 12;

export function InfoResizeHandle() {
  const { width, min, max, dragging, attach, onPointerDown, onKeyDown } =
    useInfoResize();
  // ⚠ HOVER IS STATE, NOT `group-hover:`, so the arrows are a fact in the DOM
  // rather than a class a test has to read back as a string. FOCUS shows them too
  // — the keyboard path has to say the control is a slider as plainly as the
  // pointer path does.
  const [showArrows, setShowArrows] = useState(false);
  const arrows = showArrows || dragging;

  return (
    <div ref={attach} className="relative z-[2] w-0 shrink-0">
      <div
        role="separator"
        aria-orientation="vertical"
        aria-label={INFO_RESIZE_LABEL}
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
        // arrows below are this control's focus signal, and a 12px invisible strip
        // has no face to ring.
        className={cn(
          "absolute inset-y-0 w-3 -translate-x-1/2 cursor-col-resize touch-none outline-none",
          // ⚠ HALF A DIVIDER RIGHT OF THE COLUMN'S EDGE, never `left-1/2` — see
          // {@link DIVIDER_WIDTH_VAR}. `left-1/2` of a `w-0` wrapper is 0, which
          // is the line's first pixel and not its centre.
          STRIP_LEFT
        )}
      >
        {/* Centred on the divider both ways — Samuel's "centered". */}
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
            className="h-10 w-1 shrink-0 rounded-full bg-text-primary"
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

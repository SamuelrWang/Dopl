"use client";

/**
 * THE INFO COLUMN'S WIDTH IS THE OPERATOR'S (Samuel, 2026-09-13) — *"I should be
 * able to click on it and drag left and right to dynamically change the sizing
 * proportions of those two things."*
 *
 * ⚠ **IT MOVES ONE CSS VARIABLE, `--info-w`, AND IT WRITES IT ON THE SURFACE
 * ROOT.** Everything that has to follow the width READS that variable —
 * `.channel-info-slide`'s open width (globals.css + the desktop `kit.css` copy),
 * `info-panel.tsx`'s own `w-[…]`, and `agent-panel.tsx`'s overlay, which is
 * absolutely positioned against the SAME right edge and would otherwise make the
 * divider jump sideways the moment an agent view opens (the pairing that file
 * names in as many words).
 *
 * ⚠ **THE ROOT IS FOUND, NOT PASSED.** `channel-surface.tsx` is a FRAGMENT, so
 * the handle's wrapper is a DIRECT CHILD of whichever host mounted the surface
 * (`channels-core.tsx`'s `.page-float` row, `channel-surface-standalone.tsx`'s row
 * on the desktop Home pane) and `parentElement` is the surface root on both.
 *
 * ⚠ **THE LIMITS ARE SAMUEL'S, BOTH OF THEM, AND THEY ARE NOT SYMMETRIC.**
 * Dragging LEFT stops at half the surface — *"it should only go left so that the
 * right pane and the left pane are the same size"*. Dragging RIGHT stops at
 * {@link INFO_WIDTH_DEFAULT}, the width the column has always had — *"a max
 * distance thing so that it doesn't collapse too much"*. **The column never gets
 * narrower than it is today**, which is also why nothing inside it can break: the
 * only fixed width in the pane (`info-card-rows.tsx`'s `w-[150px]` value field)
 * was measured at 380 and this floor is 380. The transcript only ever SHRINKS, and
 * it already absorbs that (`message-pane.tsx › section` carries
 * `contain: inline-size`; §5).
 *
 * The mechanism is `shared/ui/use-split-resize.ts › useSplitResize` (the
 * knowledge rail is its other config); this file is the channel's CONFIG.
 */

import {
  useSplitResize,
  type SplitResize,
  type SplitResizeConfig,
} from "@/shared/ui/use-split-resize";

/** Per DEVICE, not per channel and not per workspace — a window's proportions are
 *  a property of the screen it is on. */
export const INFO_WIDTH_STORAGE_KEY = "dopl.channel.infoWidth";

/** ⚠ TODAY'S WIDTH, AND IT IS BOTH THE DEFAULT AND THE MINIMUM. Paired with
 *  `.channel-info-slide[data-open="true"]`'s fallback and `agent-panel.tsx`'s —
 *  pinned on all three by `app-shell/frame-palette.test.ts`. */
export const INFO_WIDTH_DEFAULT = 380;

/** Set on the surface root WHILE DRAGGING, so the 200ms width transition stands
 *  down and the column tracks the pointer instead of lagging it. The CSS half is
 *  `[data-info-resizing="true"] .channel-info-slide` in both kit copies. */
export const INFO_RESIZING_ATTR = "data-info-resizing";

const INFO_RESIZE_CONFIG: SplitResizeConfig = {
  // Its FALLBACK is INFO_WIDTH_DEFAULT, stated at each consumer, so the column is
  // correct before this hook ever runs.
  variable: "--info-w",
  storageKey: INFO_WIDTH_STORAGE_KEY,
  defaultWidth: INFO_WIDTH_DEFAULT,
  min: INFO_WIDTH_DEFAULT,
  // 50/50 with the transcript.
  max: (surfaceWidth) => surfaceWidth / 2,
  // The column is RIGHT of the handle and grows leftward.
  side: "right",
  resizingAttr: INFO_RESIZING_ATTR,
  nudgePx: 16,
};

export function useInfoResize(): SplitResize {
  return useSplitResize(INFO_RESIZE_CONFIG);
}

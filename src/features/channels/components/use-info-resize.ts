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
 * names in as many words). One imperative write per pointer move, no layout
 * thrash, and **nothing about the width is rendered into HTML** — which is also
 * why there is no hydration mismatch to answer for on the web.
 *
 * ⚠ **THE ROOT IS FOUND, NOT PASSED, AND THAT IS WHAT KEEPS THIS TO ONE
 * IMPLEMENTATION.** `channel-surface.tsx` is a FRAGMENT by construction (two flex
 * siblings — its own docblock says why), so the handle's wrapper is a DIRECT CHILD
 * of whichever host mounted the surface: `channels-core.tsx`'s `.page-float`
 * row on the workspace page, `channel-surface-standalone.tsx`'s row on the desktop
 * Home pane. `parentElement` is therefore the surface root on both, and neither
 * host needed an edit.
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
 * ⚠ **THE MECHANISM IS SHARED SINCE 2026-09-29** —
 * `shared/ui/use-split-resize.ts › useSplitResize` (the knowledge rail is its
 * other config). This file is the channel's CONFIG: variable, key, limits, side.
 * The two-numbers rule (preference vs applied) lives there.
 */

import {
  clampSplitWidth,
  readStoredSplitWidth,
  splitMax,
  useSplitResize,
  type SplitResize,
  type SplitResizeConfig,
} from "@/shared/ui/use-split-resize";

/** The variable every consumer reads. Its FALLBACK is {@link INFO_WIDTH_DEFAULT}
 *  stated at each consumer, so the column is correct before this hook ever runs. */
export const INFO_WIDTH_VAR = "--info-w";

/** Per DEVICE, not per channel and not per workspace — a window's proportions are
 *  a property of the screen it is on. */
export const INFO_WIDTH_STORAGE_KEY = "dopl.channel.infoWidth";

/** ⚠ TODAY'S WIDTH, AND IT IS BOTH THE DEFAULT AND THE MINIMUM. Paired with
 *  `.channel-info-slide[data-open="true"]`'s fallback and `agent-panel.tsx`'s —
 *  pinned on all three by `app-shell/frame-palette.test.ts`. */
export const INFO_WIDTH_DEFAULT = 380;

/** One arrow-key press. */
export const INFO_NUDGE_PX = 16;

/** Set on the surface root WHILE DRAGGING, so the 200ms width transition stands
 *  down and the column tracks the pointer instead of lagging it. The CSS half is
 *  `[data-info-resizing="true"] .channel-info-slide` in both kit copies. */
export const INFO_RESIZING_ATTR = "data-info-resizing";

const INFO_RESIZE_CONFIG: SplitResizeConfig = {
  variable: INFO_WIDTH_VAR,
  storageKey: INFO_WIDTH_STORAGE_KEY,
  defaultWidth: INFO_WIDTH_DEFAULT,
  min: INFO_WIDTH_DEFAULT,
  // 50/50 with the transcript.
  max: (surfaceWidth) => surfaceWidth / 2,
  // The column is RIGHT of the handle and grows leftward.
  side: "right",
  resizingAttr: INFO_RESIZING_ATTR,
  nudgePx: INFO_NUDGE_PX,
};

/** 50/50 with the transcript, never below the floor — a surface too narrow to
 *  halve has no range at all rather than an inverted one. */
export function infoWidthMax(surfaceWidth: number): number {
  return splitMax(INFO_RESIZE_CONFIG, surfaceWidth);
}

export function clampInfoWidth(width: number, surfaceWidth: number): number {
  return clampSplitWidth(INFO_RESIZE_CONFIG, width, surfaceWidth);
}

/** `null` for "nothing stored" — the caller clamps. */
export function readStoredInfoWidth(): number | null {
  return readStoredSplitWidth(INFO_WIDTH_STORAGE_KEY);
}

export type InfoResize = SplitResize;

export function useInfoResize(): InfoResize {
  return useSplitResize(INFO_RESIZE_CONFIG);
}

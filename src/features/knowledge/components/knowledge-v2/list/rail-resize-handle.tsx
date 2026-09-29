"use client";

/**
 * THE KNOWLEDGE RAIL'S DRAG BAR (Samuel, 2026-09-29): *"look at the channels
 * page … there is like a vertical black bar, that the user can grab to adjust the
 * proportions of the panels. Let's bring that over, that will replace the toggle.
 * set a max and min limit."*
 *
 * ⚠ **THE CHANNEL'S BAR, NOT A COPY** — the view is
 * `shared/ui/split-resize-handle.tsx`, the mechanism
 * `shared/ui/use-split-resize.ts`; this file is only the rail's CONFIG.
 *
 * ⚠ **ITS PARENT IS `.baseBody`** (`../knowledge-v2.tsx` mounts it between the
 * rail and the detail pane), so `--kv-rail-w` lands on the row and the rail reads
 * it (`../knowledge-v2.module.css › .rail`). The divider it sits on is the detail
 * pane's own `border-l border-border-default`, the same shape the channel
 * divider is, so the pill's half-border offset holds on both hosts.
 */

import { SplitResizeHandle } from "@/shared/ui/split-resize-handle";
import {
  useSplitResize,
  type SplitResizeConfig,
} from "@/shared/ui/use-split-resize";

export const RAIL_RESIZE_LABEL = "Resize files";
const RAIL_WIDTH_VAR = "--kv-rail-w";
/** Per device, like the channel's. */
export const RAIL_WIDTH_STORAGE_KEY = "dopl.knowledge.railWidth";
/** The width the rail has always had — paired with `.rail`'s CSS fallback. */
export const RAIL_WIDTH_DEFAULT = 232;
export const RAIL_WIDTH_MIN = 180;
export const RAIL_WIDTH_MAX = 420;

const RAIL_RESIZE_CONFIG: SplitResizeConfig = {
  variable: RAIL_WIDTH_VAR,
  storageKey: RAIL_WIDTH_STORAGE_KEY,
  defaultWidth: RAIL_WIDTH_DEFAULT,
  min: RAIL_WIDTH_MIN,
  // 420, and never more than half the body — the embedded /home pane is narrow,
  // and the document column must stay the wider one.
  max: (rowWidth) => Math.min(RAIL_WIDTH_MAX, rowWidth / 2),
  // The rail is LEFT of the handle and grows rightward.
  side: "left",
  resizingAttr: "data-kv-rail-resizing",
  nudgePx: 16,
};

export function RailResizeHandle() {
  return (
    <SplitResizeHandle
      resize={useSplitResize(RAIL_RESIZE_CONFIG)}
      label={RAIL_RESIZE_LABEL}
    />
  );
}

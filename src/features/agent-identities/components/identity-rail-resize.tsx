"use client";

import { SplitResizeHandle } from "@/shared/ui/split-resize-handle";
import { useSplitResize, type SplitResizeConfig } from "@/shared/ui/use-split-resize";

export const RAIL_RESIZE_LABEL = "Resize activity";
/** Per device, like the channel info column's. */
export const RAIL_WIDTH_STORAGE_KEY = "dopl.identities.railWidth";
export const RAIL_WIDTH_DEFAULT = 300;
export const RAIL_WIDTH_MIN = 240;
export const RAIL_WIDTH_MAX = 480;

const RAIL_RESIZE_CONFIG: SplitResizeConfig = {
  // `.rail-layout-cols` reads it for the rail's track.
  variable: "--rail-layout-w",
  storageKey: RAIL_WIDTH_STORAGE_KEY,
  defaultWidth: RAIL_WIDTH_DEFAULT,
  min: RAIL_WIDTH_MIN,
  // Never more than half the pane: the identities stay the wider column.
  max: (rowWidth) => Math.min(RAIL_WIDTH_MAX, rowWidth / 2),
  side: "right",
  resizingAttr: "data-rail-resizing",
  nudgePx: 16,
};

/** The draggable hairline between the identities and the Activity rail; a direct child of
 *  `.rail-layout-cols`, which is the row it resizes. */
export function IdentityRailResizeHandle() {
  return <SplitResizeHandle resize={useSplitResize(RAIL_RESIZE_CONFIG)} label={RAIL_RESIZE_LABEL} />;
}

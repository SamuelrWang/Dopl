"use client";

/**
 * THE GRAB HANDLE ON THE DIVIDER between the transcript and the info column
 * (Samuel, 2026-09-13). The view is the shared
 * `shared/ui/split-resize-handle.tsx › SplitResizeHandle`; this file only names it
 * and binds the channel's config (`./use-info-resize.ts`).
 *
 * ⚠ **ITS PARENT IS THE SURFACE ROOT** — `channel-surface.tsx` is a fragment, so
 * the wrapper is a direct child of whichever host mounted the surface.
 */

import { SplitResizeHandle } from "@/shared/ui/split-resize-handle";
import { useInfoResize } from "./use-info-resize";

export { DIVIDER_WIDTH_VAR } from "@/shared/ui/split-resize-handle";

/** The separator's accessible name. Exported so the suites name it once. */
export const INFO_RESIZE_LABEL = "Resize channel info";

export function InfoResizeHandle() {
  return <SplitResizeHandle resize={useInfoResize()} label={INFO_RESIZE_LABEL} />;
}

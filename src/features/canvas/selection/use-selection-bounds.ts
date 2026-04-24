"use client";

/**
 * useSelectionBounds — computes the screen-space bounding box of the
 * currently-selected panels. Used by <SelectionMenu> to position the
 * context menu below the selection.
 *
 * Returns null if fewer than 2 panels are selected (the selection menu
 * only appears for multi-selections anyway).
 *
 * The hook depends on:
 *   - state.panels (panel positions + sizes)
 *   - state.selectedPanelIds (which ones are selected)
 *   - state.camera (the world→screen transform)
 *
 * Because all three live in canvas state, the hook re-runs automatically
 * on any relevant change via the normal React reactivity path.
 */

import { useMemo } from "react";
import { useCanvas } from "../canvas-store";

export interface ScreenBounds {
  left: number;
  top: number;
  width: number;
  height: number;
}

export function useSelectionBounds(): ScreenBounds | null {
  const { state } = useCanvas();

  return useMemo(() => {
    if (state.selectedPanelIds.length < 2) return null;

    const selectedSet = new Set(state.selectedPanelIds);
    const selected = state.panels.filter((p) => selectedSet.has(p.id));
    if (selected.length < 2) return null;

    // World-space bbox.
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const p of selected) {
      if (p.x < minX) minX = p.x;
      if (p.y < minY) minY = p.y;
      if (p.x + p.width > maxX) maxX = p.x + p.width;
      if (p.y + p.height > maxY) maxY = p.y + p.height;
    }

    // World → screen: s = w * zoom + camera.
    const { x: cx, y: cy, zoom } = state.camera;
    const left = minX * zoom + cx;
    const top = minY * zoom + cy;
    const right = maxX * zoom + cx;
    const bottom = maxY * zoom + cy;

    return {
      left,
      top,
      width: right - left,
      height: bottom - top,
    };
  }, [state.panels, state.selectedPanelIds, state.camera]);
}

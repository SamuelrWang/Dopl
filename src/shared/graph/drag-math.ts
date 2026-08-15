import type { Point } from "./types";

/**
 * Pure math for `useNodeDrag` (DOM-free tests): movement threshold (clicks
 * stay clicks), grid snapping, edge-of-container auto-scroll.
 */

export const DEFAULT_THRESHOLD = 4;
export const DEFAULT_GRID = 8;
export const AUTOSCROLL_MARGIN = 36;
export const AUTOSCROLL_MAX_SPEED = 14;

/** Snap a single coordinate to the grid (grid ≤ 0 → no snap). */
export function snap(value: number, grid: number): number {
  if (!grid || grid <= 0) return value;
  return Math.round(value / grid) * grid;
}

/** Snap a point to the grid. */
export function snapPoint(p: Point, grid: number): Point {
  return { x: snap(p.x, grid), y: snap(p.y, grid) };
}

/** Moved far enough from the press origin to be a drag? */
export function exceededThreshold(dx: number, dy: number, threshold: number): boolean {
  return Math.hypot(dx, dy) >= threshold;
}

/**
 * Per-frame {x, y} scroll deltas when the pointer nears a container edge; 0
 * when comfortably inside. Ramps linearly across the margin, capped at
 * `maxSpeed`.
 */
export function autoScrollDelta(
  pointer: Point,
  rect: { left: number; top: number; width: number; height: number },
  margin = AUTOSCROLL_MARGIN,
  maxSpeed = AUTOSCROLL_MAX_SPEED
): Point {
  const localX = pointer.x - rect.left;
  const localY = pointer.y - rect.top;
  return {
    x: axisScroll(localX, rect.width, margin, maxSpeed),
    y: axisScroll(localY, rect.height, margin, maxSpeed),
  };
}

function axisScroll(local: number, size: number, margin: number, maxSpeed: number): number {
  if (local < margin) {
    const t = Math.min(1, (margin - local) / margin);
    return -t * maxSpeed;
  }
  if (local > size - margin) {
    const t = Math.min(1, (local - (size - margin)) / margin);
    return t * maxSpeed;
  }
  return 0;
}

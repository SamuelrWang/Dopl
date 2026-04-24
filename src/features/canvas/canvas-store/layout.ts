import type { CanvasState, Panel } from "../types";

/** Compute world coordinates for a new panel placed at the camera viewport center. */
export function computeNewPanelPosition(
  state: CanvasState,
  viewportWidth: number,
  viewportHeight: number,
  panelWidth: number,
  panelHeight: number
): { x: number; y: number } {
  // Invert the world→screen transform for the viewport center point:
  //   screen = world * zoom + camera  ⇒  world = (screen - camera) / zoom
  const { x: camX, y: camY, zoom } = state.camera;
  const worldX = (viewportWidth / 2 - camX) / zoom;
  const worldY = (viewportHeight / 2 - camY) / zoom;

  return {
    x: Math.round(worldX - panelWidth / 2),
    y: Math.round(worldY - panelHeight / 2),
  };
}

/** Minimum gap (world units) to keep between a newly-placed panel and existing ones. */
const PANEL_SPAWN_GAP = 32;

function rectsOverlap(
  a: { x: number; y: number; width: number; height: number },
  b: { x: number; y: number; width: number; height: number },
  gap: number
): boolean {
  return !(
    a.x + a.width + gap <= b.x ||
    b.x + b.width + gap <= a.x ||
    a.y + a.height + gap <= b.y ||
    b.y + b.height + gap <= a.y
  );
}

/**
 * Find the closest non-overlapping position for a new panel of the given
 * size, starting from `preferredX, preferredY`. Searches concentric rings
 * (right → down → left → up → diagonals) at increasing distance until a
 * clear slot is found. Falls back to the preferred position if nothing
 * fits within a large search radius.
 */
export function findNonOverlappingPosition(
  preferredX: number,
  preferredY: number,
  width: number,
  height: number,
  panels: Panel[],
  gap: number = PANEL_SPAWN_GAP
): { x: number; y: number } {
  const fits = (x: number, y: number) => {
    const candidate = { x, y, width, height };
    for (const p of panels) {
      if (rectsOverlap(candidate, p, gap)) return false;
    }
    return true;
  };

  if (fits(preferredX, preferredY)) {
    return { x: Math.round(preferredX), y: Math.round(preferredY) };
  }

  // Step in half-panel increments so we scan with reasonable granularity.
  const step = Math.max(80, Math.min(width, height) / 2);
  // Try directions roughly ordered by UX preference (right first, then
  // down, then left/up, then diagonals).
  const directions: Array<[number, number]> = [
    [1, 0],
    [0, 1],
    [-1, 0],
    [0, -1],
    [1, 1],
    [-1, 1],
    [1, -1],
    [-1, -1],
  ];
  const MAX_RINGS = 60;
  for (let ring = 1; ring <= MAX_RINGS; ring++) {
    const d = ring * step;
    for (const [dx, dy] of directions) {
      const x = preferredX + dx * d;
      const y = preferredY + dy * d;
      if (fits(x, y)) {
        return { x: Math.round(x), y: Math.round(y) };
      }
    }
  }
  // Give up — return preferred (will overlap, but beats infinite loop).
  return { x: Math.round(preferredX), y: Math.round(preferredY) };
}

/** Build the next panel ID as a string */
export function nextPanelIdString(state: CanvasState): string {
  return `panel-${state.nextPanelId}`;
}

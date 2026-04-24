"use client";

import React from "react";
import { CanvasPanel } from "../canvas-panel";
import type { Cluster, Panel, CanvasAction } from "../types";
import { ClusterWorldLayer } from "../clusters/cluster-layer";
import { isPointInClusterShape } from "../clusters/cluster-geometry";

/**
 * Apply camera transform directly to the world DOM element, bypassing React.
 * Used during zoom/pan gestures for 60fps performance.
 */
export function applyCameraDirect(
  viewportEl: HTMLElement,
  worldEl: HTMLElement,
  cam: { x: number; y: number; zoom: number },
  _grid: { cx: number; cy: number }
) {
  const z = cam.zoom;
  worldEl.style.transform = `matrix3d(${z},0,0,0, 0,${z},0,0, 0,0,1,0, ${cam.x},${cam.y},0,1)`;
  worldEl.style.setProperty("--canvas-inv-zoom", String(1 / cam.zoom));
}

/** Below this total pointer movement we treat a drag as a "click". */
export const MARQUEE_CLICK_THRESHOLD_PX = 4;

/** Base grid cell size in world pixels. */
const BASE_GRID_CELL = 160;
/** Minimum screen-pixel size a grid cell should occupy before we double. */
const MIN_SCREEN_CELL = 60;
/** Grid extent in world units (5k from origin each way = 10k total). */
const GRID_HALF = 5000;

/**
 * Adaptive canvas grid. Doubles cell spacing as zoom decreases so
 * on-screen line density stays comfortable and the GPU does not choke
 * rasterizing thousands of hairline gradients during fast pan.
 */
function CanvasGrid({ zoom }: { zoom: number }) {
  // Double the world-space cell size until each cell is ≥ MIN_SCREEN_CELL px on screen.
  let cell = BASE_GRID_CELL;
  while (cell * zoom < MIN_SCREEN_CELL && cell < GRID_HALF) {
    cell *= 2;
  }
  // Fade grid lines when zoomed way out so they don't dominate visually.
  const opacity = Math.min(1, (cell * zoom) / 120);

  return (
    <div
      className="pointer-events-none absolute"
      style={{
        left: -GRID_HALF,
        top: -GRID_HALF,
        width: GRID_HALF * 2,
        height: GRID_HALF * 2,
        backgroundImage: `
          linear-gradient(to right, rgba(0, 0, 0, ${(0.7 * opacity).toFixed(2)}) 1px, transparent 1px),
          linear-gradient(to bottom, rgba(0, 0, 0, ${(0.7 * opacity).toFixed(2)}) 1px, transparent 1px)
        `,
        backgroundSize: `${cell}px ${cell}px`,
        backgroundPosition: "0 0",
      }}
    />
  );
}

/**
 * Memoized children of the world div. During a pure pan (no zoom change),
 * none of the props change, so React skips the entire subtree reconciliation.
 */
export const WorldContents = React.memo(function WorldContents({
  zoom,
  panels,
  selectedPanelIds,
  dispatch,
}: {
  zoom: number;
  panels: Panel[];
  selectedPanelIds: string[];
  dispatch: React.Dispatch<CanvasAction>;
}) {
  return (
    <>
      <CanvasGrid zoom={zoom} />
      <ClusterWorldLayer />
      {panels.map((panel) => (
        <CanvasPanel
          key={panel.id}
          panel={panel}
          isSelected={selectedPanelIds.includes(panel.id)}
          dispatch={dispatch}
        />
      ))}
    </>
  );
});

/** Find the topmost cluster whose world-space bounds contain the given point. */
export function findClusterAtPoint(
  clusters: Cluster[],
  panels: Panel[],
  worldPoint: { x: number; y: number }
): Cluster | null {
  for (let i = clusters.length - 1; i >= 0; i--) {
    const c = clusters[i];
    const members = panels.filter((p) => c.panelIds.includes(p.id));
    if (members.length === 0) continue;
    // Use the actual padded-per-panel shape, not the full bounding box.
    // This avoids triggering drags from empty corners of the AABB.
    if (isPointInClusterShape(members, worldPoint)) return c;
  }
  return null;
}

export interface ClusterDragState {
  clusterId: string;
  mouseX: number;
  mouseY: number;
  panels: Array<{ id: string; x: number; y: number }>;
}

export interface MarqueeState {
  /** Viewport-relative start point (pixels). */
  startX: number;
  startY: number;
  /** Viewport-relative current endpoint. */
  endX: number;
  endY: number;
  /**
   * Selection that existed BEFORE the marquee started. Used for
   * additive (shift) mode where the marquee adds to the existing set
   * instead of replacing it.
   */
  baseSelection: string[];
  /** True if the user held shift when starting the marquee (additive). */
  additive: boolean;
}

/** Does a viewport-space box intersect a panel? */
export function boxIntersectsPanel(
  box: { x1: number; y1: number; x2: number; y2: number },
  panel: Panel,
  camera: { x: number; y: number; zoom: number }
): boolean {
  // Convert panel world coords to viewport/screen coords:
  //   screen = world * zoom + camera
  const sx = panel.x * camera.zoom + camera.x;
  const sy = panel.y * camera.zoom + camera.y;
  const sw = panel.width * camera.zoom;
  const sh = panel.height * camera.zoom;

  // Standard AABB intersection in screen space.
  return box.x1 < sx + sw && box.x2 > sx && box.y1 < sy + sh && box.y2 > sy;
}

/** Read the grid cell size CSS vars (set by FlushGrid). */
export function getGridCellSize(): { cx: number; cy: number } {
  const style = getComputedStyle(document.body);
  const cx = parseFloat(style.getPropertyValue("--grid-cell-x")) || 160;
  const cy = parseFloat(style.getPropertyValue("--grid-cell-y")) || 160;
  return { cx, cy };
}

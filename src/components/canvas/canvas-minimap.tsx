"use client";

/**
 * CanvasMinimap — a small overlay in the bottom-right of the canvas viewport
 * that shows a scaled-down bird's-eye view of all panels and a rectangle
 * indicating the current viewport. Clicking/dragging on the minimap pans
 * the main canvas to that position.
 */

import { useCallback, useRef } from "react";
import { useCanvas } from "./canvas-store";
import { computePanelsBounds } from "./types";

const MINIMAP_WIDTH = 200;
const MINIMAP_HEIGHT = 140;
const MINIMAP_PADDING = 40; // world-space padding around content bounds

/** Map a world coordinate to minimap pixel coordinate. */
function worldToMinimap(
  worldX: number,
  worldY: number,
  bounds: { minX: number; minY: number; width: number; height: number },
  scale: number,
  offsetX: number,
  offsetY: number,
) {
  return {
    x: (worldX - bounds.minX) * scale + offsetX,
    y: (worldY - bounds.minY) * scale + offsetY,
  };
}

export function CanvasMinimap({
  viewportWidth,
  viewportHeight,
}: {
  viewportWidth: number;
  viewportHeight: number;
}) {
  const { state, dispatch } = useCanvas();
  const draggingRef = useRef(false);

  const bounds = computePanelsBounds(state.panels);

  // Expand bounds by padding so panels don't sit right at the minimap edge.
  const paddedBounds = bounds
    ? {
        minX: bounds.minX - MINIMAP_PADDING,
        minY: bounds.minY - MINIMAP_PADDING,
        width: bounds.width + MINIMAP_PADDING * 2,
        height: bounds.height + MINIMAP_PADDING * 2,
      }
    : { minX: 0, minY: 0, width: 1000, height: 700 };

  // Also include the current viewport in the bounds so the viewport rect
  // is always visible even when panned far from the panels.
  const { x: camX, y: camY, zoom } = state.camera;
  const vpWorldLeft = -camX / zoom;
  const vpWorldTop = -camY / zoom;
  const vpWorldWidth = viewportWidth / zoom;
  const vpWorldHeight = viewportHeight / zoom;

  const effectiveBounds = {
    minX: Math.min(paddedBounds.minX, vpWorldLeft),
    minY: Math.min(paddedBounds.minY, vpWorldTop),
    maxX: Math.max(
      paddedBounds.minX + paddedBounds.width,
      vpWorldLeft + vpWorldWidth,
    ),
    maxY: Math.max(
      paddedBounds.minY + paddedBounds.height,
      vpWorldTop + vpWorldHeight,
    ),
  };
  const effWidth = effectiveBounds.maxX - effectiveBounds.minX;
  const effHeight = effectiveBounds.maxY - effectiveBounds.minY;

  const scale = Math.min(
    (MINIMAP_WIDTH - 8) / Math.max(effWidth, 1),
    (MINIMAP_HEIGHT - 8) / Math.max(effHeight, 1),
  );

  // Center the content within the minimap
  const renderedWidth = effWidth * scale;
  const renderedHeight = effHeight * scale;
  const offsetX = (MINIMAP_WIDTH - renderedWidth) / 2;
  const offsetY = (MINIMAP_HEIGHT - renderedHeight) / 2;

  const eBounds = {
    minX: effectiveBounds.minX,
    minY: effectiveBounds.minY,
    width: effWidth,
    height: effHeight,
  };

  // Viewport rectangle in minimap coords
  const vpMini = worldToMinimap(vpWorldLeft, vpWorldTop, eBounds, scale, offsetX, offsetY);
  const vpMiniW = vpWorldWidth * scale;
  const vpMiniH = vpWorldHeight * scale;

  // Click/drag handler: pan camera so the clicked minimap point becomes viewport center
  const panToMinimapPoint = useCallback(
    (clientX: number, clientY: number, minimapEl: HTMLElement) => {
      const rect = minimapEl.getBoundingClientRect();
      const mx = clientX - rect.left;
      const my = clientY - rect.top;

      // Convert minimap pixel → world coordinate
      const worldX = (mx - offsetX) / scale + eBounds.minX;
      const worldY = (my - offsetY) / scale + eBounds.minY;

      // Set camera so this world point is at viewport center
      dispatch({
        type: "SET_CAMERA",
        camera: {
          x: viewportWidth / 2 - worldX * zoom,
          y: viewportHeight / 2 - worldY * zoom,
          zoom,
        },
      });
    },
    [dispatch, viewportWidth, viewportHeight, zoom, scale, offsetX, offsetY, eBounds.minX, eBounds.minY],
  );

  const handlePointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      e.stopPropagation();
      e.preventDefault();
      const el = e.currentTarget;
      el.setPointerCapture(e.pointerId);
      draggingRef.current = true;
      panToMinimapPoint(e.clientX, e.clientY, el);
    },
    [panToMinimapPoint],
  );

  const handlePointerMove = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (!draggingRef.current) return;
      e.stopPropagation();
      panToMinimapPoint(e.clientX, e.clientY, e.currentTarget);
    },
    [panToMinimapPoint],
  );

  const handlePointerUp = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      draggingRef.current = false;
      e.currentTarget.releasePointerCapture(e.pointerId);
    },
    [],
  );

  return (
    <div
      style={{
        position: "absolute",
        right: 16,
        bottom: 16,
        width: MINIMAP_WIDTH,
        height: MINIMAP_HEIGHT,
        zIndex: 99997,
        borderRadius: 8,
        background: "rgba(0, 0, 0, 0.55)",
        border: "1px solid rgba(255, 255, 255, 0.1)",
        backdropFilter: "blur(8px)",
        overflow: "hidden",
        cursor: "crosshair",
      }}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerUp}
    >
      {/* Panel rectangles */}
      {state.panels.map((panel) => {
        const pos = worldToMinimap(
          panel.x,
          panel.y,
          eBounds,
          scale,
          offsetX,
          offsetY,
        );
        return (
          <div
            key={panel.id}
            style={{
              position: "absolute",
              left: pos.x,
              top: pos.y,
              width: Math.max(panel.width * scale, 2),
              height: Math.max(panel.height * scale, 2),
              borderRadius: 1,
              background:
                panel.type === "connection"
                  ? "rgba(139, 92, 246, 0.5)"
                  : panel.type === "entry"
                    ? "rgba(59, 130, 246, 0.5)"
                    : panel.type === "chat"
                      ? "rgba(16, 185, 129, 0.5)"
                      : "rgba(255, 255, 255, 0.3)",
            }}
          />
        );
      })}

      {/* Viewport indicator */}
      <div
        style={{
          position: "absolute",
          left: vpMini.x,
          top: vpMini.y,
          width: vpMiniW,
          height: vpMiniH,
          border: "1.5px solid rgba(255, 255, 255, 0.6)",
          borderRadius: 2,
          background: "rgba(255, 255, 255, 0.06)",
          pointerEvents: "none",
        }}
      />
    </div>
  );
}

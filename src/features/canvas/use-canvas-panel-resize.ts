"use client";

import React, { useCallback, useRef, useState, type Dispatch } from "react";
import { useCanvasStateRef } from "./canvas-store";
import { BROWSE_PANEL_MIN_SIZE, type CanvasAction, type Panel } from "./types";

export type ResizeEdge = "n" | "s" | "e" | "w" | "ne" | "nw" | "se" | "sw";

/**
 * Edge/corner resize logic for canvas panels. Supports the 4 edges and 4
 * corners. Widths/heights are clamped to BROWSE_PANEL_MIN_SIZE. West/north
 * edges shift the panel's (x, y) so the opposite edge stays anchored.
 *
 * Dispatches `RESIZE_PANEL` (always) and `MOVE_PANEL` (only when the edge
 * causes the origin to shift).
 */
export function useCanvasPanelResize(
  panel: Panel,
  dispatch: Dispatch<CanvasAction>
) {
  const canvasStateRef = useCanvasStateRef();

  const resizeOriginRef = useRef<{
    mouseX: number;
    mouseY: number;
    x: number;
    y: number;
    width: number;
    height: number;
    edge: ResizeEdge;
  } | null>(null);

  const [isResizing, setIsResizing] = useState(false);

  const handleEdgePointerDown = useCallback(
    (edge: ResizeEdge) => (e: React.PointerEvent<HTMLDivElement>) => {
      e.stopPropagation();
      e.preventDefault();
      e.currentTarget.setPointerCapture(e.pointerId);
      resizeOriginRef.current = {
        mouseX: e.clientX,
        mouseY: e.clientY,
        x: panel.x,
        y: panel.y,
        width: panel.width,
        height: panel.height,
        edge,
      };
      setIsResizing(true);
    },
    [panel.x, panel.y, panel.width, panel.height]
  );

  const handleEdgePointerMove = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      const origin = resizeOriginRef.current;
      if (!origin) return;
      const zoom = canvasStateRef.current.camera.zoom;
      const dx = (e.clientX - origin.mouseX) / zoom;
      const dy = (e.clientY - origin.mouseY) / zoom;
      const { edge } = origin;
      const minW = BROWSE_PANEL_MIN_SIZE.width;
      const minH = BROWSE_PANEL_MIN_SIZE.height;

      let newX = origin.x;
      let newY = origin.y;
      let newW = origin.width;
      let newH = origin.height;

      // East edge — grow right
      if (edge.includes("e")) newW = Math.max(minW, origin.width + dx);
      // West edge — grow left (move x, shrink width)
      if (edge.includes("w")) {
        newW = Math.max(minW, origin.width - dx);
        newX = origin.x + (origin.width - newW);
      }
      // South edge — grow down
      if (edge === "s" || edge === "se" || edge === "sw") newH = Math.max(minH, origin.height + dy);
      // North edge — grow up (move y, shrink height)
      if (edge === "n" || edge === "ne" || edge === "nw") {
        newH = Math.max(minH, origin.height - dy);
        newY = origin.y + (origin.height - newH);
      }

      dispatch({ type: "RESIZE_PANEL", id: panel.id, width: newW, height: newH });
      if (newX !== origin.x || newY !== origin.y) {
        dispatch({ type: "MOVE_PANEL", id: panel.id, x: newX, y: newY });
      }
    },
    [dispatch, panel.id, canvasStateRef]
  );

  const handleEdgePointerUp = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      const target = e.currentTarget;
      if (target.hasPointerCapture(e.pointerId)) {
        target.releasePointerCapture(e.pointerId);
      }
      resizeOriginRef.current = null;
      setIsResizing(false);
    },
    []
  );

  return {
    isResizing,
    handleEdgePointerDown,
    handleEdgePointerMove,
    handleEdgePointerUp,
  };
}

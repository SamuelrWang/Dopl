/**
 * useEdgeScroll — auto-pan the canvas when the cursor hits the window edge.
 *
 * Attaches a mousemove listener on `window` to detect when the cursor is
 * within EDGE_THRESHOLD pixels of any window boundary. While at the edge,
 * a requestAnimationFrame loop smoothly pans the camera in that direction.
 *
 * Uses the same direct-DOM-mutation pattern as the wheel handler in
 * canvas.tsx: writes to pendingCameraRef + cameraRef, calls
 * applyCameraDirect, and debounces a SET_CAMERA dispatch to React state.
 */

import { useEffect, useRef } from "react";
import { applyCameraDirect } from "./canvas";
import type { CanvasAction } from "./types";

const EDGE_THRESHOLD = 3; // px from window edge to trigger
const EDGE_SCROLL_SPEED = 800; // px/sec at zoom=1
const FLUSH_DELAY = 80; // ms debounce to React state

interface EdgeScrollRefs {
  viewportRef: React.RefObject<HTMLDivElement | null>;
  worldRef: React.RefObject<HTMLDivElement | null>;
  cameraRef: React.MutableRefObject<{ x: number; y: number; zoom: number }>;
  pendingCameraRef: React.MutableRefObject<{
    x: number;
    y: number;
    zoom: number;
  } | null>;
  gestureFlushRef: React.MutableRefObject<ReturnType<typeof setTimeout> | null>;
  gridCellRef: React.MutableRefObject<{ cx: number; cy: number }>;
  dispatch: React.Dispatch<CanvasAction>;
}

export function useEdgeScroll({
  viewportRef,
  worldRef,
  cameraRef,
  pendingCameraRef,
  gestureFlushRef,
  gridCellRef,
  dispatch,
}: EdgeScrollRefs) {
  // Direction vector: -1, 0, or +1 for each axis.
  const dirRef = useRef<{ dx: number; dy: number }>({ dx: 0, dy: 0 });
  const rafRef = useRef<number | null>(null);
  const lastTimeRef = useRef<number>(0);
  const flushTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    function getEdgeDir(clientX: number, clientY: number) {
      const w = window.innerWidth;
      const h = window.innerHeight;
      const dx =
        clientX <= EDGE_THRESHOLD
          ? -1
          : clientX >= w - 1 - EDGE_THRESHOLD
            ? 1
            : 0;
      const dy =
        clientY <= EDGE_THRESHOLD
          ? -1
          : clientY >= h - 1 - EDGE_THRESHOLD
            ? 1
            : 0;
      return { dx, dy };
    }

    function tick(now: number) {
      const { dx, dy } = dirRef.current;
      if (dx === 0 && dy === 0) {
        rafRef.current = null;
        return;
      }

      const dt = lastTimeRef.current ? (now - lastTimeRef.current) / 1000 : 0;
      lastTimeRef.current = now;

      // Cap dt to avoid huge jumps if the tab was backgrounded.
      const clampedDt = Math.min(dt, 0.1);

      const cam = pendingCameraRef.current ?? cameraRef.current;
      const speed = EDGE_SCROLL_SPEED / cam.zoom;
      const nextCam = {
        x: cam.x - dx * speed * clampedDt,
        y: cam.y - dy * speed * clampedDt,
        zoom: cam.zoom,
      };

      pendingCameraRef.current = nextCam;
      cameraRef.current = nextCam;

      const el = viewportRef.current;
      const worldEl = worldRef.current;
      if (el && worldEl) {
        applyCameraDirect(el, worldEl, nextCam, gridCellRef.current);
      }

      // Debounce flush to React state.
      if (flushTimerRef.current) clearTimeout(flushTimerRef.current);
      flushTimerRef.current = setTimeout(() => {
        const final = pendingCameraRef.current;
        if (final) {
          dispatch({ type: "SET_CAMERA", camera: final });
          pendingCameraRef.current = null;
        }
        flushTimerRef.current = null;
      }, FLUSH_DELAY);

      rafRef.current = requestAnimationFrame(tick);
    }

    function onMouseMove(e: MouseEvent) {
      const { dx, dy } = getEdgeDir(e.clientX, e.clientY);
      const prev = dirRef.current;

      if (dx === prev.dx && dy === prev.dy) return; // no change
      dirRef.current = { dx, dy };

      // Start loop if we just entered an edge zone.
      if ((dx !== 0 || dy !== 0) && rafRef.current === null) {
        lastTimeRef.current = 0; // reset so first frame has dt=0
        rafRef.current = requestAnimationFrame(tick);
      }
    }

    function onMouseLeave() {
      // Cursor left the window — stop panning.
      dirRef.current = { dx: 0, dy: 0 };
    }

    window.addEventListener("mousemove", onMouseMove);
    document.addEventListener("mouseleave", onMouseLeave);

    return () => {
      window.removeEventListener("mousemove", onMouseMove);
      document.removeEventListener("mouseleave", onMouseLeave);
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
      if (flushTimerRef.current) clearTimeout(flushTimerRef.current);
    };
  }, [
    viewportRef,
    worldRef,
    cameraRef,
    pendingCameraRef,
    gestureFlushRef,
    gridCellRef,
    dispatch,
  ]);
}

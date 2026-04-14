"use client";

/**
 * PublishedCanvas — standalone canvas renderer for the public detail page.
 *
 * Renders published cluster panels in an infinite 2D space with pan/zoom.
 * Supports two modes:
 *   - readOnly: viewers can pan & zoom, no panel interaction
 *   - editable: creator can drag panels, positions saved via callback
 *
 * Architecture mirrors the main canvas's performance patterns:
 *   - matrix3d transform on the world div
 *   - Native wheel listener (passive: false) for intercepting pinch-zoom
 *   - Direct DOM mutation during gestures, debounced React state sync
 *   - transform-origin: 0 0 (required for anchored zoom math)
 */

import { useEffect, useLayoutEffect, useRef, useState, useCallback } from "react";
import { PublishedEntryCard } from "./published-entry-card";
import type { PublishedPanel } from "@/lib/community/types";

const MIN_ZOOM = 0.25;
const MAX_ZOOM = 4.0;

const BASE_GRID_CELL = 160;
const MIN_SCREEN_CELL = 60;
const GRID_HALF = 5000;

interface Camera {
  x: number;
  y: number;
  zoom: number;
}

interface PublishedCanvasProps {
  panels: PublishedPanel[];
  readOnly: boolean;
  onPanelsMove?: (moves: Array<{ id: string; x: number; y: number }>) => void;
}

// ── Adaptive Grid ───────────────────────────────────────────────────

function CanvasGrid({ zoom }: { zoom: number }) {
  let cell = BASE_GRID_CELL;
  while (cell * zoom < MIN_SCREEN_CELL && cell < GRID_HALF) {
    cell *= 2;
  }
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
      }}
    />
  );
}

// ── Camera helpers ──────────────────────────────────────────────────

let gestureClassTimer: ReturnType<typeof setTimeout> | null = null;

function applyCameraDirect(
  viewportEl: HTMLElement | HTMLDivElement | null,
  worldEl: HTMLElement | HTMLDivElement | null,
  cam: Camera
) {
  if (!viewportEl || !worldEl) return;
  const z = cam.zoom;
  worldEl.style.transform = `matrix3d(${z},0,0,0, 0,${z},0,0, 0,0,1,0, ${cam.x},${cam.y},0,1)`;

  viewportEl.classList.add("canvas-gesturing");
  if (gestureClassTimer) clearTimeout(gestureClassTimer);
  gestureClassTimer = setTimeout(() => {
    viewportEl.classList.remove("canvas-gesturing");
    gestureClassTimer = null;
  }, 150);
}

function computeInitialCamera(
  panels: PublishedPanel[],
  viewportWidth: number,
  viewportHeight: number
): Camera {
  if (panels.length === 0) return { x: 0, y: 0, zoom: 1 };

  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const p of panels) {
    minX = Math.min(minX, p.x);
    minY = Math.min(minY, p.y);
    maxX = Math.max(maxX, p.x + p.width);
    maxY = Math.max(maxY, p.y + p.height);
  }

  const padding = 80;
  const boundsW = maxX - minX + padding * 2;
  const boundsH = maxY - minY + padding * 2;
  const centerX = (minX + maxX) / 2;
  const centerY = (minY + maxY) / 2;

  const zoom = Math.max(
    MIN_ZOOM,
    Math.min(1, Math.min(viewportWidth / boundsW, viewportHeight / boundsH))
  );

  return {
    x: viewportWidth / 2 - centerX * zoom,
    y: viewportHeight / 2 - centerY * zoom,
    zoom,
  };
}

// ── Main Component ──────────────────────────────────────────────────

export function PublishedCanvas({
  panels,
  readOnly,
  onPanelsMove,
}: PublishedCanvasProps) {
  const viewportRef = useRef<HTMLDivElement>(null);
  const worldRef = useRef<HTMLDivElement>(null);

  const [camera, setCamera] = useState<Camera>({ x: 0, y: 0, zoom: 1 });
  const cameraRef = useRef(camera);
  const pendingCameraRef = useRef<Camera | null>(null);
  const gestureFlushRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const initializedRef = useRef(false);

  // Panel positions state (for edit mode drag)
  const [panelPositions, setPanelPositions] = useState<Map<string, { x: number; y: number }>>(new Map());
  const dragRef = useRef<{
    panelId: string;
    startMouseX: number;
    startMouseY: number;
    startX: number;
    startY: number;
  } | null>(null);

  // Initialize panel positions from props
  useEffect(() => {
    const map = new Map<string, { x: number; y: number }>();
    for (const p of panels) {
      map.set(p.id, { x: p.x, y: p.y });
    }
    setPanelPositions(map);
  }, [panels]);

  // Fit camera to content on mount
  useEffect(() => {
    if (initializedRef.current || panels.length === 0) return;
    const el = viewportRef.current;
    if (!el) return;

    const { width, height } = el.getBoundingClientRect();
    if (width === 0 || height === 0) return;

    const cam = computeInitialCamera(panels, width, height);
    cameraRef.current = cam;
    setCamera(cam);
    initializedRef.current = true;
  }, [panels]);

  // Apply camera transform
  useLayoutEffect(() => {
    const worldEl = worldRef.current;
    const el = viewportRef.current;
    if (worldEl && el) {
      const cam = pendingCameraRef.current ?? cameraRef.current;
      applyCameraDirect(el, worldEl, cam);
    }
  });

  // ── Wheel handler (pan + zoom) ────────────────────────────────────

  useEffect(() => {
    const el = viewportRef.current;
    if (!el) return;

    const GESTURE_TIMEOUT_MS = 100;
    let gestureMode: "pan" | "zoom" | null = null;
    let gestureTime = 0;

    function handleWheel(e: WheelEvent) {
      e.preventDefault();
      const worldEl = worldRef.current;
      if (!worldEl) return;

      const now = performance.now();
      if (now - gestureTime > GESTURE_TIMEOUT_MS) gestureMode = null;
      gestureTime = now;

      const cam = cameraRef.current;

      // Detect pinch (ctrlKey on trackpad)
      const isPinch = e.ctrlKey;

      if (gestureMode === null) {
        gestureMode = isPinch ? "zoom" : "pan";
      }

      let nextCam: Camera;

      if (gestureMode === "zoom") {
        const cursorX = e.clientX;
        const cursorY = e.clientY;
        const normalizedDelta = e.deltaY;
        const factor = Math.exp(-normalizedDelta * 0.01);
        const newZoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, cam.zoom * factor));

        const wx = (cursorX - cam.x) / cam.zoom;
        const wy = (cursorY - cam.y) / cam.zoom;

        nextCam = {
          x: cursorX - wx * newZoom,
          y: cursorY - wy * newZoom,
          zoom: newZoom,
        };
      } else {
        nextCam = {
          x: cam.x - e.deltaX,
          y: cam.y - e.deltaY,
          zoom: cam.zoom,
        };
      }

      pendingCameraRef.current = nextCam;
      cameraRef.current = nextCam;
      applyCameraDirect(el, worldEl, nextCam);

      if (gestureFlushRef.current) clearTimeout(gestureFlushRef.current);
      gestureFlushRef.current = setTimeout(() => {
        const p = pendingCameraRef.current;
        if (p) {
          setCamera(p);
          pendingCameraRef.current = null;
        }
        gestureFlushRef.current = null;
      }, 80);
    }

    el.addEventListener("wheel", handleWheel, { passive: false });
    return () => el.removeEventListener("wheel", handleWheel);
  }, []);

  // ── Panel drag (edit mode only) ───────────────────────────────────

  const handlePanelPointerDown = useCallback(
    (panelId: string, e: React.PointerEvent) => {
      if (readOnly) return;
      e.stopPropagation();
      e.preventDefault();

      const pos = panelPositions.get(panelId);
      if (!pos) return;

      dragRef.current = {
        panelId,
        startMouseX: e.clientX,
        startMouseY: e.clientY,
        startX: pos.x,
        startY: pos.y,
      };

      const target = e.currentTarget as HTMLElement;
      target.setPointerCapture(e.pointerId);
    },
    [readOnly, panelPositions]
  );

  const handlePanelPointerMove = useCallback(
    (e: React.PointerEvent) => {
      if (!dragRef.current) return;
      const { panelId, startMouseX, startMouseY, startX, startY } = dragRef.current;
      const zoom = cameraRef.current.zoom;
      const dx = (e.clientX - startMouseX) / zoom;
      const dy = (e.clientY - startMouseY) / zoom;

      setPanelPositions((prev) => {
        const next = new Map(prev);
        next.set(panelId, { x: startX + dx, y: startY + dy });
        return next;
      });
    },
    []
  );

  const handlePanelPointerUp = useCallback(() => {
    if (!dragRef.current) return;
    const { panelId } = dragRef.current;
    dragRef.current = null;

    // Report the new position
    const pos = panelPositions.get(panelId);
    if (pos && onPanelsMove) {
      onPanelsMove([{ id: panelId, x: pos.x, y: pos.y }]);
    }
  }, [panelPositions, onPanelsMove]);

  return (
    <div
      ref={viewportRef}
      className="relative w-full h-full overflow-hidden bg-[#0c0c0c]"
      style={{ touchAction: "none" }}
    >
      {/* World layer */}
      <div
        ref={worldRef}
        className="absolute inset-0"
        style={{ transformOrigin: "0 0" }}
      >
        <CanvasGrid zoom={camera.zoom} />

        {/* Panels */}
        {panels.map((panel) => {
          const pos = panelPositions.get(panel.id) || { x: panel.x, y: panel.y };
          return (
            <div
              key={panel.id}
              style={{
                position: "absolute",
                left: pos.x,
                top: pos.y,
                width: panel.width,
                height: panel.height,
                transform: "translateZ(0)",
                willChange: "transform",
                backfaceVisibility: "hidden",
                cursor: readOnly ? "default" : "grab",
              }}
              onPointerDown={(e) => handlePanelPointerDown(panel.id, e)}
              onPointerMove={handlePanelPointerMove}
              onPointerUp={handlePanelPointerUp}
            >
              <PublishedEntryCard
                title={panel.title}
                summary={panel.summary}
                sourceUrl={panel.source_url}
              />
            </div>
          );
        })}
      </div>
    </div>
  );
}

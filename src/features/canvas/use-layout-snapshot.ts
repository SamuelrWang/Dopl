"use client";

/**
 * useLayoutSnapshot — persists a tiny "shape-only" snapshot of the
 * canvas to localStorage on every meaningful change. The Next.js
 * `loading.tsx` for the canvas route reads this snapshot on the next
 * navigation and renders panel-shaped skeletons at the saved
 * positions while the server fetches the real state.
 *
 * Snapshot intentionally carries NO content — only geometry + the
 * camera transform — so it's cheap to serialize and harmless if a
 * different user signs in (the worst case is a brief mismatch before
 * the real canvas paints over it).
 */

import { useEffect } from "react";
import { useCanvas } from "./canvas-store";

export const LAYOUT_SNAPSHOT_PREFIX = "canvas-layout-snapshot:";
const DEBOUNCE_MS = 500;
const MAX_PANELS = 200;

export interface LayoutSnapshotPanel {
  id: string;
  type: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface LayoutSnapshot {
  v: 1;
  camera: { x: number; y: number; zoom: number };
  panels: LayoutSnapshotPanel[];
  savedAt: number;
}

export function useLayoutSnapshot(canvasSlug: string) {
  const { state } = useCanvas();
  const { camera, panels } = state;

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!canvasSlug) return;

    const handle = window.setTimeout(() => {
      try {
        const snapshot: LayoutSnapshot = {
          v: 1,
          camera: { x: camera.x, y: camera.y, zoom: camera.zoom },
          panels: panels.slice(0, MAX_PANELS).map((p) => ({
            id: p.id,
            type: p.type,
            x: p.x,
            y: p.y,
            width: p.width,
            height: p.height,
          })),
          savedAt: Date.now(),
        };
        window.localStorage.setItem(
          `${LAYOUT_SNAPSHOT_PREFIX}${canvasSlug}`,
          JSON.stringify(snapshot)
        );
      } catch {
        // localStorage may be full / disabled; the skeleton is a
        // progressive enhancement, so silently drop.
      }
    }, DEBOUNCE_MS);

    return () => window.clearTimeout(handle);
  }, [canvasSlug, camera.x, camera.y, camera.zoom, panels]);
}

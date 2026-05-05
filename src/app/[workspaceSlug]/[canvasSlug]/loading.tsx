"use client";

/**
 * Suspense fallback for the canvas page. Renders panel-shaped
 * skeletons at the user's last-known layout so the page shows
 * something familiar instantly while the server fetches the real
 * state. Layout is snapshot to localStorage by `useLayoutSnapshot`
 * inside CanvasClientShell.
 *
 * On first-ever visit (no cache), renders nothing — falling back
 * to the brief blank we had before. Returning visits get the ghost.
 */

import { useSyncExternalStore } from "react";
import { useParams } from "next/navigation";
import {
  LAYOUT_SNAPSHOT_PREFIX,
  type LayoutSnapshot,
} from "@/features/canvas/use-layout-snapshot";

const noopSubscribe = () => () => {};

// Module-level cache so `useSyncExternalStore` gets a referentially
// stable snapshot across re-render calls — without it, returning a
// freshly-parsed object each call would trip React's tearing check.
const snapshotCache = new Map<string, LayoutSnapshot | null>();

function readSnapshotCached(canvasSlug: string | undefined): LayoutSnapshot | null {
  if (!canvasSlug || typeof window === "undefined") return null;
  if (snapshotCache.has(canvasSlug)) return snapshotCache.get(canvasSlug) ?? null;
  let result: LayoutSnapshot | null = null;
  try {
    const raw = window.localStorage.getItem(
      `${LAYOUT_SNAPSHOT_PREFIX}${canvasSlug}`
    );
    if (raw) {
      const parsed = JSON.parse(raw) as LayoutSnapshot;
      if (parsed && parsed.v === 1 && Array.isArray(parsed.panels)) {
        result = parsed;
      }
    }
  } catch {
    // bad cache — ignore
  }
  snapshotCache.set(canvasSlug, result);
  return result;
}

export default function CanvasLoading() {
  const params = useParams<{ canvasSlug: string }>();
  const canvasSlug = params?.canvasSlug;
  const snapshot = useSyncExternalStore(
    noopSubscribe,
    () => readSnapshotCached(canvasSlug),
    () => null
  );

  if (!snapshot) {
    return (
      <div
        className="fixed inset-0 z-[1] pointer-events-none"
        aria-busy="true"
        aria-live="polite"
      />
    );
  }

  const { camera, panels } = snapshot;
  return (
    <div
      className="fixed inset-0 z-[1] overflow-hidden pointer-events-none"
      aria-busy="true"
      aria-live="polite"
    >
      <div
        className="absolute inset-0"
        style={{
          transform: `matrix3d(${camera.zoom},0,0,0, 0,${camera.zoom},0,0, 0,0,1,0, ${camera.x},${camera.y},0,1)`,
          transformOrigin: "0 0",
        }}
      >
        {panels.map((p) => (
          <div
            key={p.id}
            className="absolute animate-pulse rounded-lg border border-white/[0.08] bg-white/[0.04]"
            style={{
              left: p.x,
              top: p.y,
              width: p.width,
              height: p.height,
            }}
          />
        ))}
      </div>
    </div>
  );
}

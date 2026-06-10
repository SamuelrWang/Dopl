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

import { useRef, useSyncExternalStore } from "react";
import { useParams } from "next/navigation";
import shellStyles from "@/shared/layout/app-shell/app-shell.module.css";
import {
  layoutSnapshotKey,
  type LayoutSnapshot,
} from "@/features/canvas/use-layout-snapshot";

const noopSubscribe = () => () => {};

function readSnapshotRaw(
  workspaceSlug: string | undefined,
  canvasSlug: string | undefined
): LayoutSnapshot | null {
  if (typeof window === "undefined") return null;
  const key = layoutSnapshotKey(workspaceSlug, canvasSlug);
  if (!key) return null;
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as LayoutSnapshot;
    if (parsed && parsed.v === 1 && Array.isArray(parsed.panels)) {
      return parsed;
    }
  } catch {
    // bad cache — ignore
  }
  return null;
}

export default function CanvasLoading() {
  const params = useParams<{ workspaceSlug: string; canvasSlug: string }>();
  const workspaceSlug = params?.workspaceSlug;
  const canvasSlug = params?.canvasSlug;

  // Per-mount snapshot cache. `useSyncExternalStore` calls
  // `getSnapshot` on every render and Object.is-compares; returning a
  // freshly-parsed object each call would trip the tearing check. A
  // ref scoped to THIS mount caches the value while still picking up
  // a fresh localStorage read on every navigation back to this page
  // (a module-level cache, which we tried first, would silently serve
  // a stale snapshot from an earlier visit).
  const cacheRef = useRef<{
    key: string | null;
    value: LayoutSnapshot | null;
  } | null>(null);

  const snapshot = useSyncExternalStore(
    noopSubscribe,
    () => {
      const key = layoutSnapshotKey(workspaceSlug, canvasSlug);
      if (cacheRef.current && cacheRef.current.key === key) {
        return cacheRef.current.value;
      }
      const value = readSnapshotRaw(workspaceSlug, canvasSlug);
      cacheRef.current = { key, value };
      return value;
    },
    () => null
  );

  // Both branches paint the AppShell panel rect (the canvas portal's
  // exact box) in the light surface so the swap to the live canvas
  // doesn't flash.
  const panelRectStyle: React.CSSProperties = {
    top: "var(--app-panel-top)",
    left: "var(--app-panel-left)",
    right: "var(--app-panel-right)",
    bottom: "var(--app-panel-bottom)",
    borderRadius: "var(--shell-panel-radius) 18px 18px 18px",
    backgroundColor: "#eef1f5",
  };

  if (!snapshot) {
    return (
      <div
        className={`${shellStyles.lightScope} fixed z-[31] pointer-events-none`}
        style={panelRectStyle}
        aria-busy="true"
        aria-live="polite"
      />
    );
  }

  const { camera, panels } = snapshot;
  return (
    <div
      className={`${shellStyles.lightScope} fixed z-[31] overflow-hidden pointer-events-none`}
      style={panelRectStyle}
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
            className="absolute animate-pulse rounded-lg border border-border-default bg-surface-raised-2"
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

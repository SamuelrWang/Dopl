"use client";

/**
 * use-canvas-db-sync.ts — Write-through sync of the client-side reducer
 * to the server-side database. Initial state is server-rendered by the
 * /canvas page and seeded into the reducer directly, so this hook has
 * no mount-fetch: it only watches state changes and emits the
 * appropriate POST / PATCH / DELETE calls.
 *
 * On state changes (debounced):
 *   - Camera changes → PATCH /api/canvas/state (1000ms idle)
 *   - Panel create/close → POST/DELETE /api/canvas/panels (immediate)
 *   - Panel position changes → PATCH /api/canvas/panels/batch (500ms)
 *   - Counter changes → batched with camera saves
 */

import { useEffect, useRef } from "react";
import { CANVAS_STORAGE_KEY_PREFIX, CANVAS_ACTIVE_USER_KEY } from "@/config";
import { useCanvas, useCanvasScope } from "./canvas-store";
import type { Panel } from "./types";
import { panelToDbRow } from "@/features/canvas/server/panel-dto";
import {
  fetchCurrentVersion,
  patchCanvasState,
} from "./canvas-state-sync";

/**
 * Build the standard headers for every canvas-sync fetch. Stamps the
 * active canvas id so the server can scope the write to the correct
 * workspace. Falls back to user-default if no canvas id is set.
 */
function syncHeaders(canvasId: string | null): HeadersInit {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (canvasId) headers["X-Canvas-Id"] = canvasId;
  return headers;
}

// ── localStorage timestamp tracking ──────────────────────────────────
// Lightweight write-breadcrumb used to debug stale local state. The
// companion read helper was removed — we don't actually consult this
// for conflict resolution anywhere (the audit found it was dead code),
// and real conflict resolution needs a different approach anyway.

const LAST_SAVED_KEY_SUFFIX = ":lastSavedAt";

function setLocalSaveTimestamp() {
  try {
    const uid = localStorage.getItem(CANVAS_ACTIVE_USER_KEY);
    const key = uid
      ? `${CANVAS_STORAGE_KEY_PREFIX}:${uid}${LAST_SAVED_KEY_SUFFIX}`
      : `${CANVAS_STORAGE_KEY_PREFIX}${LAST_SAVED_KEY_SUFFIX}`;
    localStorage.setItem(key, Date.now().toString());
  } catch {
    // ignore
  }
}

// ── Snapshot helpers for change detection ─────────────────────────────

function cameraKey(cam: { x: number; y: number; zoom: number }): string {
  return `${cam.x.toFixed(1)}|${cam.y.toFixed(1)}|${cam.zoom.toFixed(3)}`;
}

function panelPositionKey(panels: Panel[]): string {
  return panels
    .map((p) => `${p.id}:${p.x.toFixed(0)},${p.y.toFixed(0)}`)
    .sort()
    .join(";");
}

function panelIdSet(panels: Panel[]): Set<string> {
  return new Set(panels.map((p) => p.id));
}

// ── The hook ──────────────────────────────────────────────────────────

export function useCanvasDbSync() {
  const { state } = useCanvas();
  const scope = useCanvasScope();
  const canvasId = scope?.canvasId ?? null;
  const syncedRef = useRef(false);
  const prevCameraRef = useRef("");
  const prevPanelIdsRef = useRef<Set<string>>(new Set());
  const prevPositionsRef = useRef("");
  const prevCountersRef = useRef("");
  const prevTitlesRef = useRef<Map<string, string>>(new Map());
  const prevClustersRef = useRef("");
  const prevPanelDataRef = useRef<Map<string, string>>(new Map());
  const cameraTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const positionTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const titleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const clusterTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const panelDataTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Optimistic-lock version for canvas_state. Hydrated on mount via a
  // GET, then bumped in lock-step with every successful PATCH so cross-
  // tab races resolve as 409 + refetch instead of silent overwrites.
  const stateVersionRef = useRef<number | null>(null);

  // Mount-time version hydration. Runs once per canvasId — if the
  // canvas changes (Phase 2 switcher), we re-fetch so the next PATCH
  // doesn't carry a stale baseline. Result null is fine — the first
  // PATCH will create the row and learn the server's version then.
  useEffect(() => {
    if (!canvasId) return;
    let cancelled = false;
    fetchCurrentVersion(canvasId).then((v) => {
      if (cancelled) return;
      if (v !== null) stateVersionRef.current = v;
    });
    return () => {
      cancelled = true;
    };
  }, [canvasId]);

  // Seed tracking refs SYNCHRONOUSLY from the server-rendered initial
  // state — not inside a useEffect — so the write-through effects below
  // (which fire on first render) don't see an empty prevPanelIdsRef and
  // treat every pre-hydrated panel as "new", redundantly POSTing them.
  //
  // This block runs on every render but is guarded by syncedRef so the
  // expensive serialization only happens once.
  if (!syncedRef.current) {
    syncedRef.current = true;
    prevCameraRef.current = cameraKey(state.camera);
    prevPanelIdsRef.current = panelIdSet(state.panels);
    prevPositionsRef.current = panelPositionKey(state.panels);
    prevCountersRef.current = `${state.nextPanelId}|${state.nextClusterId}`;
    const titles = new Map<string, string>();
    for (const p of state.panels) {
      if ("title" in p && typeof p.title === "string") {
        titles.set(p.id, p.title);
      }
    }
    prevTitlesRef.current = titles;
    prevClustersRef.current = JSON.stringify(state.clusters);
    const dataMap = new Map<string, string>();
    for (const p of state.panels) {
      const row = panelToDbRow(p);
      dataMap.set(p.id, JSON.stringify(row.panel_data));
    }
    prevPanelDataRef.current = dataMap;
  }

  // ── Track changes and sync to DB (split into focused effects) ─────

  // Camera + counters → debounced save (1000ms idle)
  useEffect(() => {
    if (!syncedRef.current) return;
    const currentCamera = cameraKey(state.camera);
    const currentCounters = `${state.nextPanelId}|${state.nextClusterId}`;
    if (currentCamera !== prevCameraRef.current || currentCounters !== prevCountersRef.current) {
      if (cameraTimerRef.current) clearTimeout(cameraTimerRef.current);
      cameraTimerRef.current = setTimeout(() => {
        void patchCanvasState(canvasId, stateVersionRef, {
          camera_x: state.camera.x,
          camera_y: state.camera.y,
          camera_zoom: state.camera.zoom,
          next_panel_id: state.nextPanelId,
          next_cluster_id: state.nextClusterId,
        }).then(() => setLocalSaveTimestamp());
        cameraTimerRef.current = null;
      }, 1000);
      prevCameraRef.current = currentCamera;
      prevCountersRef.current = currentCounters;
    }
  }, [state.camera, state.nextPanelId, state.nextClusterId]);

  // Panel add/remove → immediate POST/DELETE
  useEffect(() => {
    if (!syncedRef.current) return;
    const currentPanelIds = panelIdSet(state.panels);
    const prevIds = prevPanelIdsRef.current;

    // Panel added → POST to DB (immediate)
    for (const panel of state.panels) {
      if (!prevIds.has(panel.id)) {
        const row = panelToDbRow(panel);
        fetch("/api/canvas/panels", {
          method: "POST",
          headers: syncHeaders(canvasId),
          body: JSON.stringify(row),
        }).then(() => setLocalSaveTimestamp()).catch((err) => console.error("[canvas-sync] panel create failed:", err));
      }
    }

    // Panel removed → DELETE from DB (immediate)
    for (const prevId of prevIds) {
      if (!currentPanelIds.has(prevId)) {
        fetch(`/api/canvas/panels/${encodeURIComponent(prevId)}`, {
          method: "DELETE",
          headers: canvasId ? { "X-Canvas-Id": canvasId } : undefined,
        }).catch((err) => console.error("[canvas-sync] panel delete failed:", err));
      }
    }

    prevPanelIdsRef.current = currentPanelIds;
  }, [state.panels]);

  // Panel positions → debounced batch update (500ms)
  useEffect(() => {
    if (!syncedRef.current) return;
    const currentPositions = panelPositionKey(state.panels);
    if (currentPositions !== prevPositionsRef.current) {
      if (positionTimerRef.current) clearTimeout(positionTimerRef.current);
      positionTimerRef.current = setTimeout(() => {
        const updates = state.panels.map((p) => ({
          panel_id: p.id,
          x: p.x,
          y: p.y,
        }));
        fetch("/api/canvas/panels/batch", {
          method: "PATCH",
          headers: syncHeaders(canvasId),
          body: JSON.stringify({ updates }),
        }).catch((err) => console.error("[canvas-sync] position batch update failed:", err));
        positionTimerRef.current = null;
      }, 500);
      prevPositionsRef.current = currentPositions;
    }
  }, [state.panels]);

  // Panel titles → debounced batch update (1000ms)
  useEffect(() => {
    if (!syncedRef.current) return;
    const currentTitles = new Map<string, string>();
    const changedTitles: { panel_id: string; title: string }[] = [];
    for (const p of state.panels) {
      if ("title" in p && typeof p.title === "string") {
        currentTitles.set(p.id, p.title);
        const prev = prevTitlesRef.current.get(p.id);
        if (prev !== undefined && prev !== p.title) {
          changedTitles.push({ panel_id: p.id, title: p.title });
        }
      }
    }
    if (changedTitles.length > 0) {
      if (titleTimerRef.current) clearTimeout(titleTimerRef.current);
      titleTimerRef.current = setTimeout(() => {
        fetch("/api/canvas/panels/batch", {
          method: "PATCH",
          headers: syncHeaders(canvasId),
          body: JSON.stringify({ updates: changedTitles }),
        }).catch((err) => console.error("[canvas-sync] title batch update failed:", err));
        titleTimerRef.current = null;
      }, 1000);
    }
    prevTitlesRef.current = currentTitles;
  }, [state.panels]);

  // Clusters → debounced save (1000ms)
  useEffect(() => {
    if (!syncedRef.current) return;
    const currentClustersKey = JSON.stringify(state.clusters);
    if (currentClustersKey !== prevClustersRef.current) {
      if (clusterTimerRef.current) clearTimeout(clusterTimerRef.current);
      clusterTimerRef.current = setTimeout(() => {
        void patchCanvasState(canvasId, stateVersionRef, {
          clusters: state.clusters,
        }).then(() => setLocalSaveTimestamp());
        clusterTimerRef.current = null;
      }, 1000);
      prevClustersRef.current = currentClustersKey;
    }
  }, [state.clusters]);

  // Panel data → debounced batch update (2000ms)
  useEffect(() => {
    if (!syncedRef.current) return;
    const panelDataUpdates: { panel_id: string; panel_data: Record<string, unknown> }[] = [];
    const currentPanelData = new Map<string, string>();
    for (const panel of state.panels) {
      const row = panelToDbRow(panel);
      const dataKey = JSON.stringify(row.panel_data);
      currentPanelData.set(panel.id, dataKey);
      const prevData = prevPanelDataRef.current.get(panel.id);
      if (prevData !== undefined && prevData !== dataKey) {
        panelDataUpdates.push({ panel_id: panel.id, panel_data: row.panel_data });
      }
    }
    if (panelDataUpdates.length > 0) {
      if (panelDataTimerRef.current) clearTimeout(panelDataTimerRef.current);
      panelDataTimerRef.current = setTimeout(() => {
        fetch("/api/canvas/panels/batch", {
          method: "PATCH",
          headers: syncHeaders(canvasId),
          body: JSON.stringify({ updates: panelDataUpdates }),
        }).then(() => setLocalSaveTimestamp())
          .catch((err) => console.error("[canvas-sync] panel_data batch update failed:", err));
        panelDataTimerRef.current = null;
      }, 2000);
    }
    prevPanelDataRef.current = currentPanelData;
  }, [state.panels]);

  // Cleanup timers on unmount
  useEffect(() => {
    return () => {
      if (cameraTimerRef.current) clearTimeout(cameraTimerRef.current);
      if (positionTimerRef.current) clearTimeout(positionTimerRef.current);
      if (titleTimerRef.current) clearTimeout(titleTimerRef.current);
      if (clusterTimerRef.current) clearTimeout(clusterTimerRef.current);
      if (panelDataTimerRef.current) clearTimeout(panelDataTimerRef.current);
    };
  }, []);

  // ── Flush-on-unload ──────────────────────────────────────────────
  // If the user reloads or closes the tab while a debounced save is
  // pending (camera moved, panel dragged, title edited…), the timer
  // never fires and the change is lost. Fix: on pagehide / beforeunload,
  // fire any pending save immediately with `keepalive: true` so the
  // browser delivers it even as the page unloads. We always send the
  // latest state — cheaper than tracking per-category dirty flags, and
  // the DB accepts idempotent writes here.
  //
  // We keep a ref to the latest state so the unload handler isn't
  // reading stale closure values.
  const latestStateRef = useRef(state);
  latestStateRef.current = state;

  useEffect(() => {
    function flushPendingSaves() {
      if (!syncedRef.current) return;
      const s = latestStateRef.current;
      const anyPending =
        cameraTimerRef.current !== null ||
        positionTimerRef.current !== null ||
        titleTimerRef.current !== null ||
        clusterTimerRef.current !== null ||
        panelDataTimerRef.current !== null;
      if (!anyPending) return;

      // Camera + counters
      if (cameraTimerRef.current) {
        clearTimeout(cameraTimerRef.current);
        cameraTimerRef.current = null;
        void patchCanvasState(
          canvasId,
          stateVersionRef,
          {
            camera_x: s.camera.x,
            camera_y: s.camera.y,
            camera_zoom: s.camera.zoom,
            next_panel_id: s.nextPanelId,
            next_cluster_id: s.nextClusterId,
          },
          { keepalive: true },
        );
      }

      // Positions + panel_data (all panel batches flushed together)
      if (positionTimerRef.current || panelDataTimerRef.current) {
        if (positionTimerRef.current) clearTimeout(positionTimerRef.current);
        if (panelDataTimerRef.current) clearTimeout(panelDataTimerRef.current);
        positionTimerRef.current = null;
        panelDataTimerRef.current = null;
        const updates = s.panels.map((p) => {
          const row = panelToDbRow(p);
          return {
            panel_id: p.id,
            x: p.x,
            y: p.y,
            panel_data: row.panel_data,
          };
        });
        fetch("/api/canvas/panels/batch", {
          method: "PATCH",
          headers: syncHeaders(canvasId),
          keepalive: true,
          body: JSON.stringify({ updates }),
        }).catch(() => {});
      }

      // Titles
      if (titleTimerRef.current) {
        clearTimeout(titleTimerRef.current);
        titleTimerRef.current = null;
        const titleUpdates: { panel_id: string; title: string }[] = [];
        for (const p of s.panels) {
          if ("title" in p && typeof (p as { title?: unknown }).title === "string") {
            titleUpdates.push({
              panel_id: p.id,
              title: (p as { title: string }).title,
            });
          }
        }
        if (titleUpdates.length > 0) {
          fetch("/api/canvas/panels/batch", {
            method: "PATCH",
            headers: syncHeaders(canvasId),
            keepalive: true,
            body: JSON.stringify({ updates: titleUpdates }),
          }).catch(() => {});
        }
      }

      // Clusters
      if (clusterTimerRef.current) {
        clearTimeout(clusterTimerRef.current);
        clusterTimerRef.current = null;
        void patchCanvasState(
          canvasId,
          stateVersionRef,
          { clusters: s.clusters },
          { keepalive: true },
        );
      }
    }

    // `pagehide` is more reliable than `beforeunload` on mobile Safari
    // and persists through bfcache (if the page is eventually unloaded).
    // Listening to both covers all desktop + mobile cases.
    window.addEventListener("pagehide", flushPendingSaves);
    window.addEventListener("beforeunload", flushPendingSaves);
    // Also flush when the tab goes hidden for an extended period — some
    // browsers unload background tabs to free memory.
    function onVisibilityChange() {
      if (document.visibilityState === "hidden") {
        flushPendingSaves();
      }
    }
    document.addEventListener("visibilitychange", onVisibilityChange);

    return () => {
      window.removeEventListener("pagehide", flushPendingSaves);
      window.removeEventListener("beforeunload", flushPendingSaves);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, []);
}


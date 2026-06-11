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
import type { Edge, Panel } from "./types";
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
function syncHeaders(workspaceId: string | null): HeadersInit {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (workspaceId) headers["X-Workspace-Id"] = workspaceId;
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

/** panelId → workflowId for every workflow header panel. */
function workflowIdMap(panels: Panel[]): Map<string, string> {
  const m = new Map<string, string>();
  for (const p of panels) {
    if (p.type === "workflow") m.set(p.id, p.workflowId);
  }
  return m;
}

// ── The hook ──────────────────────────────────────────────────────────

export function useCanvasDbSync() {
  const { state } = useCanvas();
  const scope = useCanvasScope();
  const workspaceId = scope?.workspaceId ?? null;
  const syncedRef = useRef(false);
  const prevCameraRef = useRef("");
  const prevPanelIdsRef = useRef<Set<string>>(new Set());
  const prevEdgesRef = useRef<Map<string, Edge>>(new Map());
  // In-flight panel creates, keyed by panel id. Edge creates await their
  // endpoints' entries here: an UNDO_DELETE restores panels + edges in
  // one commit, and an edge POST that races ahead of its panel POST
  // violates the canvas_edges → canvas_panels FK and is lost for good.
  const pendingPanelCreatesRef = useRef<Map<string, Promise<unknown>>>(
    new Map()
  );
  // Pending debounced updates accumulate across effect runs — a second
  // change inside the debounce window must MERGE with (not replace) the
  // first, or the earlier panel's update is silently dropped when the
  // timer is rescheduled.
  const pendingTitleUpdatesRef = useRef<Map<string, string>>(new Map());
  const pendingPanelDataRef = useRef<
    Map<string, Record<string, unknown>>
  >(new Map());
  const prevPositionsRef = useRef("");
  const prevCountersRef = useRef("");
  const prevTitlesRef = useRef<Map<string, string>>(new Map());
  // panelId → workflowId for workflow header panels, so removing a header
  // panel can also delete its backing workflows row.
  const prevWorkflowsRef = useRef<Map<string, string>>(new Map());
  const prevPanelDataRef = useRef<Map<string, string>>(new Map());
  const cameraTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const positionTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const titleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const panelDataTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Optimistic-lock version for canvas_state. Hydrated on mount via a
  // GET, then bumped in lock-step with every successful PATCH so cross-
  // tab races resolve as 409 + refetch instead of silent overwrites.
  const stateVersionRef = useRef<number | null>(null);

  // Mount-time version hydration. Runs once per workspaceId — if the
  // canvas changes (Phase 2 switcher), we re-fetch so the next PATCH
  // doesn't carry a stale baseline. Result null is fine — the first
  // PATCH will create the row and learn the server's version then.
  useEffect(() => {
    if (!workspaceId) return;
    let cancelled = false;
    fetchCurrentVersion(workspaceId).then((v) => {
      if (cancelled) return;
      if (v !== null) stateVersionRef.current = v;
    });
    return () => {
      cancelled = true;
    };
  }, [workspaceId]);

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
    prevCountersRef.current = `${state.nextPanelId}`;
    const titles = new Map<string, string>();
    for (const p of state.panels) {
      if ("title" in p && typeof p.title === "string") {
        titles.set(p.id, p.title);
      }
    }
    prevTitlesRef.current = titles;
    prevWorkflowsRef.current = workflowIdMap(state.panels);
    prevEdgesRef.current = new Map(state.edges.map((e) => [e.id, e]));
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
    const currentCounters = `${state.nextPanelId}`;
    if (currentCamera !== prevCameraRef.current || currentCounters !== prevCountersRef.current) {
      if (cameraTimerRef.current) clearTimeout(cameraTimerRef.current);
      cameraTimerRef.current = setTimeout(() => {
        void patchCanvasState(workspaceId, stateVersionRef, {
          camera_x: state.camera.x,
          camera_y: state.camera.y,
          camera_zoom: state.camera.zoom,
          next_panel_id: state.nextPanelId,
        }).then(() => setLocalSaveTimestamp());
        cameraTimerRef.current = null;
      }, 1000);
      prevCameraRef.current = currentCamera;
      prevCountersRef.current = currentCounters;
    }
  }, [state.camera, state.nextPanelId]);

  // Panel add/remove → immediate POST/DELETE
  useEffect(() => {
    if (!syncedRef.current) return;
    const currentPanelIds = panelIdSet(state.panels);
    const prevIds = prevPanelIdsRef.current;

    // Panel added → POST to DB (immediate)
    for (const panel of state.panels) {
      if (!prevIds.has(panel.id)) {
        const row = panelToDbRow(panel);
        const create = fetch("/api/canvas/panels", {
          method: "POST",
          headers: syncHeaders(workspaceId),
          body: JSON.stringify(row),
        }).then(() => setLocalSaveTimestamp()).catch((err) => console.error("[canvas-sync] panel create failed:", err));
        pendingPanelCreatesRef.current.set(panel.id, create);
        void create.finally(() => {
          if (pendingPanelCreatesRef.current.get(panel.id) === create) {
            pendingPanelCreatesRef.current.delete(panel.id);
          }
        });
      }
    }

    // Panel removed → DELETE from DB (immediate). A removed workflow header
    // panel also deletes its backing workflows row (detaches its KBs/skills;
    // panels stay).
    for (const prevId of prevIds) {
      if (!currentPanelIds.has(prevId)) {
        fetch(`/api/canvas/panels/${encodeURIComponent(prevId)}`, {
          method: "DELETE",
          headers: workspaceId ? { "X-Workspace-Id": workspaceId } : undefined,
        }).catch((err) => console.error("[canvas-sync] panel delete failed:", err));
        const workflowId = prevWorkflowsRef.current.get(prevId);
        if (workflowId) {
          fetch(`/api/workflows/${encodeURIComponent(workflowId)}`, {
            method: "DELETE",
            headers: workspaceId ? { "X-Workspace-Id": workspaceId } : undefined,
          }).catch((err) =>
            console.error("[canvas-sync] workflow delete failed:", err)
          );
        }
      }
    }

    prevPanelIdsRef.current = currentPanelIds;
    prevWorkflowsRef.current = workflowIdMap(state.panels);
  }, [state.panels]);

  // Edge add/remove → immediate POST/DELETE (same shape as panels; the
  // edge id is a client-generated uuid so no response round-trip needed)
  useEffect(() => {
    if (!syncedRef.current) return;
    const current = new Map(state.edges.map((e) => [e.id, e]));
    const prev = prevEdgesRef.current;

    for (const [id, edge] of current) {
      if (!prev.has(id)) {
        // Wait for any in-flight creates of the endpoint panels first
        // (UNDO_DELETE restores panel + edge in one commit) — the edge
        // row's FK requires both panel rows to exist.
        const deps = [
          pendingPanelCreatesRef.current.get(edge.fromPanelId),
          pendingPanelCreatesRef.current.get(edge.toPanelId),
        ].filter(Boolean);
        void Promise.allSettled(deps)
          .then(() =>
            fetch("/api/canvas/edges", {
              method: "POST",
              headers: syncHeaders(workspaceId),
              body: JSON.stringify(edge),
            })
          )
          .then((res) => {
            if (!res.ok) {
              console.error(
                `[canvas-sync] edge create failed: HTTP ${res.status}`,
                edge
              );
            }
            setLocalSaveTimestamp();
          })
          .catch((err) =>
            console.error("[canvas-sync] edge create failed:", err)
          );
      }
    }

    for (const id of prev.keys()) {
      if (!current.has(id)) {
        fetch(`/api/canvas/edges/${encodeURIComponent(id)}`, {
          method: "DELETE",
          headers: workspaceId ? { "X-Workspace-Id": workspaceId } : undefined,
        }).catch((err) =>
          console.error("[canvas-sync] edge delete failed:", err)
        );
      }
    }

    prevEdgesRef.current = current;
  }, [state.edges]);

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
          headers: syncHeaders(workspaceId),
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
      for (const u of changedTitles) {
        pendingTitleUpdatesRef.current.set(u.panel_id, u.title);
      }
      if (titleTimerRef.current) clearTimeout(titleTimerRef.current);
      titleTimerRef.current = setTimeout(() => {
        const updates = [...pendingTitleUpdatesRef.current].map(
          ([panel_id, title]) => ({ panel_id, title })
        );
        pendingTitleUpdatesRef.current = new Map();
        fetch("/api/canvas/panels/batch", {
          method: "PATCH",
          headers: syncHeaders(workspaceId),
          body: JSON.stringify({ updates }),
        }).catch((err) => console.error("[canvas-sync] title batch update failed:", err));
        titleTimerRef.current = null;
      }, 1000);
    }
    prevTitlesRef.current = currentTitles;
  }, [state.panels]);

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
      for (const u of panelDataUpdates) {
        pendingPanelDataRef.current.set(u.panel_id, u.panel_data);
      }
      if (panelDataTimerRef.current) clearTimeout(panelDataTimerRef.current);
      panelDataTimerRef.current = setTimeout(() => {
        const updates = [...pendingPanelDataRef.current].map(
          ([panel_id, panel_data]) => ({ panel_id, panel_data })
        );
        pendingPanelDataRef.current = new Map();
        fetch("/api/canvas/panels/batch", {
          method: "PATCH",
          headers: syncHeaders(workspaceId),
          body: JSON.stringify({ updates }),
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
        panelDataTimerRef.current !== null;
      if (!anyPending) return;

      // Camera + counters
      if (cameraTimerRef.current) {
        clearTimeout(cameraTimerRef.current);
        cameraTimerRef.current = null;
        void patchCanvasState(
          workspaceId,
          stateVersionRef,
          {
            camera_x: s.camera.x,
            camera_y: s.camera.y,
            camera_zoom: s.camera.zoom,
            next_panel_id: s.nextPanelId,
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
          headers: syncHeaders(workspaceId),
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
            headers: syncHeaders(workspaceId),
            keepalive: true,
            body: JSON.stringify({ updates: titleUpdates }),
          }).catch(() => {});
        }
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


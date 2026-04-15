"use client";

/**
 * use-canvas-db-sync.ts — Syncs the full canvas state between the client-side
 * reducer (+ localStorage cache) and the server-side database.
 *
 * DB is the source of truth. localStorage is a write-through cache.
 *
 * On mount:
 *   - Fetch GET /api/canvas/state
 *   - If 404 → first-time migration: push localStorage state to DB
 *   - If 200 → dispatch HYDRATE_FROM_DB to merge DB state with local transient state
 *
 * On state changes (debounced):
 *   - Camera changes → PATCH /api/canvas/state (1000ms idle)
 *   - Panel create/close → POST/DELETE /api/canvas/panels (immediate)
 *   - Panel position changes → PATCH /api/canvas/panels/batch (500ms)
 *   - Counter changes → batched with camera saves
 */

import { useEffect, useRef } from "react";
import { CANVAS_STORAGE_KEY_PREFIX, CANVAS_ACTIVE_USER_KEY } from "@/lib/config";
import { useCanvas } from "./canvas-store";
import type {
  Panel,
  ChatPanelData,
  EntryPanelData,
  ConnectionPanelData,
  ClusterBrainPanelData,
  Cluster,
} from "./types";

// ── Serialization helpers ────────────────────────────────────────────

/** Serialize a panel into the shape the DB expects. */
function panelToDbRow(panel: Panel) {
  const base = {
    panel_id: panel.id,
    panel_type: panel.type,
    x: panel.x,
    y: panel.y,
    width: panel.width,
    height: panel.height,
    entry_id: null as string | null,
    title: null as string | null,
    summary: null as string | null,
    source_url: null as string | null,
    panel_data: {} as Record<string, unknown>,
  };

  switch (panel.type) {
    case "entry":
      base.entry_id = panel.entryId;
      base.title = panel.title;
      base.summary = panel.summary;
      base.source_url = panel.sourceUrl;
      base.panel_data = {
        sourcePlatform: panel.sourcePlatform,
        sourceAuthor: panel.sourceAuthor,
        thumbnailUrl: panel.thumbnailUrl,
        useCase: panel.useCase,
        complexity: panel.complexity,
        tags: panel.tags,
        readme: panel.readme,
        agentsMd: panel.agentsMd,
        manifest: panel.manifest,
        createdAt: panel.createdAt,
      };
      break;
    case "chat":
      base.title = panel.title;
      base.panel_data = {
        conversationId: panel.conversationId,
        pinned: panel.pinned,
        expiresAt: panel.expiresAt,
      };
      break;
    case "connection":
      base.panel_data = { apiKey: panel.apiKey };
      break;
    case "cluster-brain":
      base.panel_data = {
        clusterId: panel.clusterId,
        clusterName: panel.clusterName,
        instructions: panel.instructions,
        memories: panel.memories,
        status: panel.status,
        errorMessage: panel.errorMessage,
      };
      break;
    case "browse":
      break;
  }

  return base;
}

/** Deserialize a DB row back to a Panel. */
function dbRowToPanel(row: Record<string, unknown>): Panel | null {
  const base = {
    id: row.panel_id as string,
    x: (row.x as number) ?? 0,
    y: (row.y as number) ?? 0,
    width: (row.width as number) ?? 480,
    height: (row.height as number) ?? 600,
  };
  const data = (row.panel_data as Record<string, unknown>) || {};
  const type = row.panel_type as string;

  switch (type) {
    case "entry":
      return {
        ...base,
        type: "entry",
        entryId: (row.entry_id as string) || "",
        title: (row.title as string) || "Untitled",
        summary: (row.summary as string) || null,
        sourceUrl: (row.source_url as string) || "",
        sourcePlatform: (data.sourcePlatform as string) || null,
        sourceAuthor: (data.sourceAuthor as string) || null,
        thumbnailUrl: (data.thumbnailUrl as string) || null,
        useCase: (data.useCase as string) || null,
        complexity: (data.complexity as string) || null,
        tags: (data.tags as Array<{ type: string; value: string }>) || [],
        readme: (data.readme as string) || "",
        agentsMd: (data.agentsMd as string) || "",
        manifest: (data.manifest as Record<string, unknown>) || {},
        createdAt: (data.createdAt as string) || new Date().toISOString(),
      } as EntryPanelData;
    case "chat":
      return {
        ...base,
        type: "chat",
        title: (row.title as string) || "New Chat",
        messages: [],
        isProcessing: false,
        activeEntryId: null,
        conversationId: (data.conversationId as string) || undefined,
        pinned: (data.pinned as boolean) || false,
        expiresAt: (data.expiresAt as string) || undefined,
      } as ChatPanelData;
    case "connection":
      return {
        ...base,
        type: "connection",
        apiKey: (data.apiKey as string) || null,
      } as ConnectionPanelData;
    case "browse":
      return { ...base, type: "browse" };
    case "cluster-brain":
      return {
        ...base,
        type: "cluster-brain",
        clusterId: (data.clusterId as string) || "",
        clusterName: (data.clusterName as string) || "",
        instructions: (data.instructions as string) || "",
        memories: (data.memories as string[]) || [],
        status: (data.status as "generating" | "ready" | "error") || "ready",
        errorMessage: (data.errorMessage as string) || null,
      } as ClusterBrainPanelData;
    default:
      return null;
  }
}

// ── localStorage timestamp tracking ──────────────────────────────────

const LAST_SAVED_KEY_SUFFIX = ":lastSavedAt";

function getLocalSaveTimestamp(): number {
  try {
    const uid = localStorage.getItem(CANVAS_ACTIVE_USER_KEY);
    const key = uid
      ? `${CANVAS_STORAGE_KEY_PREFIX}:${uid}${LAST_SAVED_KEY_SUFFIX}`
      : `${CANVAS_STORAGE_KEY_PREFIX}${LAST_SAVED_KEY_SUFFIX}`;
    const val = localStorage.getItem(key);
    return val ? parseInt(val, 10) : 0;
  } catch {
    return 0;
  }
}

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
  const { state, dispatch } = useCanvas();
  const syncedRef = useRef(false);
  const prevCameraRef = useRef("");
  const prevPanelIdsRef = useRef<Set<string>>(new Set());
  const prevPositionsRef = useRef("");
  const prevCountersRef = useRef("");
  const prevTitlesRef = useRef<Map<string, string>>(new Map());
  const prevClustersRef = useRef("");
  const cameraTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const positionTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const titleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const clusterTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ── Mount: load from DB and reconcile ──────────────────────────────
  useEffect(() => {
    if (syncedRef.current) return;
    syncedRef.current = true;

    async function loadFromDb() {
      try {
        const res = await fetch("/api/canvas/state");

        if (res.status === 404) {
          // First-time migration: only push to DB if localStorage actually
          // has panels. Otherwise this is a fresh device / new domain (e.g.
          // localhost) with no local data — just create an empty DB row so
          // subsequent saves work, but don't overwrite anything.
          if (state.panels.filter((p) => p.type === "entry" || p.type === "chat").length > 0) {
            await migrateToDb(state);
          } else {
            // Create an empty canvas_state row so future PATCHes have a target
            await fetch("/api/canvas/state", {
              method: "PATCH",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ camera_x: 0, camera_y: 0, camera_zoom: 1 }),
            });
          }
          initTracking(state);
          return;
        }

        if (!res.ok) {
          console.error("[canvas-sync] Failed to load canvas state:", res.status, res.statusText);
          return;
        }

        const { canvas_state: cs, panels: dbPanels } = await res.json();

        // Safeguard: if localStorage is newer than DB, push local to DB
        // instead of overwriting local with stale DB data. This handles
        // the case where a previous DB write failed silently.
        const localSavedAt = getLocalSaveTimestamp();
        const dbUpdatedAt = cs.updated_at ? new Date(cs.updated_at).getTime() : 0;

        if (localSavedAt > 0 && localSavedAt > dbUpdatedAt + 5000) {
          // localStorage is significantly newer — push local state to DB
          await migrateToDb(state);
          initTracking(state);
          return;
        }

        // Reconstruct panels from DB rows
        const panels: Panel[] = [];
        for (const row of dbPanels) {
          const panel = dbRowToPanel(row);
          if (panel) panels.push(panel);
        }

        // Reconstruct clusters from DB (JSONB array on canvas_state)
        const dbClusters: Cluster[] = Array.isArray(cs.clusters) ? cs.clusters : [];
        // Merge: prefer DB clusters, but keep any local-only clusters
        // (e.g. just created this session before sync completed)
        const dbClusterIds = new Set(dbClusters.map((c: Cluster) => c.id));
        const mergedClusters = [
          ...dbClusters,
          ...state.clusters.filter((c) => !dbClusterIds.has(c.id)),
        ];

        // Dispatch HYDRATE_FROM_DB — merges with local transient state
        dispatch({
          type: "HYDRATE_FROM_DB",
          camera: {
            x: cs.camera_x,
            y: cs.camera_y,
            zoom: cs.camera_zoom,
          },
          panels,
          clusters: mergedClusters,
          nextPanelId: cs.next_panel_id,
          nextClusterId: cs.next_cluster_id,
        });

        initTracking({
          ...state,
          camera: { x: cs.camera_x, y: cs.camera_y, zoom: cs.camera_zoom },
          panels,
          nextPanelId: cs.next_panel_id,
          nextClusterId: cs.next_cluster_id,
        });
      } catch (err) {
        console.error("[canvas-sync] Failed to load from DB:", err);
      }
    }

    function initTracking(s: typeof state) {
      prevCameraRef.current = cameraKey(s.camera);
      prevPanelIdsRef.current = panelIdSet(s.panels);
      prevPositionsRef.current = panelPositionKey(s.panels);
      prevCountersRef.current = `${s.nextPanelId}|${s.nextClusterId}`;
      const titles = new Map<string, string>();
      for (const p of s.panels) {
        if ("title" in p && typeof p.title === "string") {
          titles.set(p.id, p.title);
        }
      }
      prevTitlesRef.current = titles;
      prevClustersRef.current = JSON.stringify(s.clusters);
    }

    loadFromDb();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Track changes and sync to DB ──────────────────────────────────
  useEffect(() => {
    if (!syncedRef.current) return;

    const currentCamera = cameraKey(state.camera);
    const currentPanelIds = panelIdSet(state.panels);
    const currentPositions = panelPositionKey(state.panels);
    const currentCounters = `${state.nextPanelId}|${state.nextClusterId}`;

    // Camera changed → debounced save (1000ms idle)
    if (currentCamera !== prevCameraRef.current || currentCounters !== prevCountersRef.current) {
      if (cameraTimerRef.current) clearTimeout(cameraTimerRef.current);
      cameraTimerRef.current = setTimeout(() => {
        fetch("/api/canvas/state", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            camera_x: state.camera.x,
            camera_y: state.camera.y,
            camera_zoom: state.camera.zoom,
            next_panel_id: state.nextPanelId,
            next_cluster_id: state.nextClusterId,
          }),
        }).then(() => setLocalSaveTimestamp()).catch((err) => console.error("[canvas-sync] camera save failed:", err));
        cameraTimerRef.current = null;
      }, 1000);
      prevCameraRef.current = currentCamera;
      prevCountersRef.current = currentCounters;
    }

    // Panel added → POST to DB (immediate)
    const prevIds = prevPanelIdsRef.current;
    for (const panel of state.panels) {
      if (!prevIds.has(panel.id)) {
        const row = panelToDbRow(panel);
        fetch("/api/canvas/panels", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(row),
        }).then(() => setLocalSaveTimestamp()).catch((err) => console.error("[canvas-sync] panel create failed:", err));
      }
    }

    // Panel removed → DELETE from DB (immediate)
    for (const prevId of prevIds) {
      if (!currentPanelIds.has(prevId)) {
        fetch(`/api/canvas/panels/${encodeURIComponent(prevId)}`, {
          method: "DELETE",
        }).catch((err) => console.error("[canvas-sync] panel delete failed:", err));
      }
    }

    // Panel positions changed → debounced batch update (500ms)
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
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ updates }),
        }).catch((err) => console.error("[canvas-sync] position batch update failed:", err));
        positionTimerRef.current = null;
      }, 500);
    }

    // Panel titles changed → debounced batch update (1000ms)
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
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ updates: changedTitles }),
        }).catch((err) => console.error("[canvas-sync] title batch update failed:", err));
        titleTimerRef.current = null;
      }, 1000);
    }

    // Clusters changed → debounced save (1000ms)
    const currentClustersKey = JSON.stringify(state.clusters);
    if (currentClustersKey !== prevClustersRef.current) {
      if (clusterTimerRef.current) clearTimeout(clusterTimerRef.current);
      clusterTimerRef.current = setTimeout(() => {
        fetch("/api/canvas/state", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ clusters: state.clusters }),
        }).then(() => setLocalSaveTimestamp())
          .catch((err) => console.error("[canvas-sync] cluster save failed:", err));
        clusterTimerRef.current = null;
      }, 1000);
    }

    prevPanelIdsRef.current = currentPanelIds;
    prevPositionsRef.current = currentPositions;
    prevTitlesRef.current = currentTitles;
    prevClustersRef.current = currentClustersKey;
  }, [state]);

  // Cleanup timers on unmount
  useEffect(() => {
    return () => {
      if (cameraTimerRef.current) clearTimeout(cameraTimerRef.current);
      if (positionTimerRef.current) clearTimeout(positionTimerRef.current);
      if (titleTimerRef.current) clearTimeout(titleTimerRef.current);
      if (clusterTimerRef.current) clearTimeout(clusterTimerRef.current);
    };
  }, []);
}

// ── Migration helper ──────────────────────────────────────────────────

async function migrateToDb(state: {
  camera: { x: number; y: number; zoom: number };
  panels: Panel[];
  clusters: Cluster[];
  nextPanelId: number;
  nextClusterId: number;
}) {
  const panels = state.panels.map(panelToDbRow);

  await fetch("/api/canvas/state/migrate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      camera_x: state.camera.x,
      camera_y: state.camera.y,
      camera_zoom: state.camera.zoom,
      next_panel_id: state.nextPanelId,
      next_cluster_id: state.nextClusterId,
      sidebar_open: false,
      clusters: state.clusters,
      panels,
    }),
  });
}

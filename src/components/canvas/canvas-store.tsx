"use client";

/**
 * CanvasProvider — React Context + reducer that owns all canvas state.
 *
 * State (camera position, panels, conversations) is persisted to localStorage
 * with a small debounce so frequent dispatches (e.g. drag) don't thrash disk.
 * Hydration happens once on mount via a lazy useReducer initializer.
 */

import {
  createContext,
  useContext,
  useEffect,
  useReducer,
  useRef,
  type Dispatch,
  type MutableRefObject,
  type ReactNode,
} from "react";
import type {
  BrowsePanelData,
  CanvasAction,
  CanvasState,
  ChatPanelData,
  Cluster,
  ConnectionPanelData,
  EntryPanelData,
  IngestionPanelData,
  Panel,
} from "./types";
import {
  BROWSE_PANEL_SIZE,
  CONNECTION_PANEL_SIZE,
  ENTRY_PANEL_SIZE,
  INGESTION_PANEL_SIZE,
  INITIAL_CANVAS_STATE,
  MIN_CLUSTER_SIZE,
  isPanelDeletable,
} from "./types";
import type {
  ChatMessage,
  ProgressEvent,
} from "@/components/ingest/chat-message";
import { useCanvasSync } from "./use-canvas-sync";

const STORAGE_KEY = "sie:canvas:state";
const SAVE_DEBOUNCE_MS = 500;

// ── Cluster helpers ────────────────────────────────────────────────

/**
 * Remove a panel id from every cluster, then drop clusters that have
 * fallen below MIN_CLUSTER_SIZE. Shared by CLOSE_PANEL and CREATE_CLUSTER
 * (which enforces one-cluster-per-panel by stripping newly-clustered ids
 * from any pre-existing clusters).
 */
function stripFromClusters(
  clusters: Cluster[],
  panelIds: ReadonlySet<string>
): Cluster[] {
  const next: Cluster[] = [];
  for (const c of clusters) {
    const remaining = c.panelIds.filter((id) => !panelIds.has(id));
    if (remaining.length === c.panelIds.length) {
      next.push(c);
      continue;
    }
    if (remaining.length < MIN_CLUSTER_SIZE) continue; // auto-dissolve
    next.push({ ...c, panelIds: remaining });
  }
  return next;
}

// ── Reducer ────────────────────────────────────────────────────────

function reducer(state: CanvasState, action: CanvasAction): CanvasState {
  switch (action.type) {
    case "HYDRATE":
      return action.state;

    case "SET_CAMERA":
      return { ...state, camera: action.camera };

    case "PAN_CAMERA":
      return {
        ...state,
        camera: {
          ...state.camera,
          x: state.camera.x + action.dx,
          y: state.camera.y + action.dy,
        },
      };

    case "ZOOM_AT": {
      // Anchored zoom — keep the world point under the cursor fixed at
      // the cursor's screen position as zoom changes. See plan for the
      // derivation. k = newZoom / oldZoom.
      const { cursor, newZoom } = action;
      const { x: oldX, y: oldY, zoom: oldZoom } = state.camera;
      if (newZoom === oldZoom) return state;
      const k = newZoom / oldZoom;
      return {
        ...state,
        camera: {
          x: cursor.x * (1 - k) + oldX * k,
          y: cursor.y * (1 - k) + oldY * k,
          zoom: newZoom,
        },
      };
    }

    case "MOVE_PANEL":
      return {
        ...state,
        panels: state.panels.map((p) =>
          p.id === action.id ? { ...p, x: action.x, y: action.y } : p
        ),
      };

    case "RESIZE_PANEL":
      return {
        ...state,
        panels: state.panels.map((p) =>
          p.id === action.id
            ? { ...p, width: action.width, height: action.height }
            : p
        ),
      };

    case "MOVE_PANELS": {
      // Build a lookup so the map below is O(n) instead of O(n·m).
      const moveMap = new Map(action.moves.map((m) => [m.id, m]));
      return {
        ...state,
        panels: state.panels.map((p) => {
          const move = moveMap.get(p.id);
          return move ? { ...p, x: move.x, y: move.y } : p;
        }),
      };
    }

    case "CREATE_CHAT_PANEL": {
      const newPanel: ChatPanelData = {
        id: action.id,
        type: "chat",
        x: action.x,
        y: action.y,
        width: 480,
        height: 600,
        title: action.title,
        messages: [],
        isProcessing: false,
        activeEntryId: null,
        pendingInput: action.pendingInput,
      };
      return {
        ...state,
        panels: [...state.panels, newPanel],
        nextPanelId: state.nextPanelId + 1,
      };
    }

    case "CLEAR_PENDING_INPUT":
      return {
        ...state,
        panels: state.panels.map((p) =>
          p.id === action.panelId && p.type === "chat"
            ? { ...p, pendingInput: undefined }
            : p
        ),
      };

    case "CLOSE_PANEL": {
      // Refuse to close undeletable panels (currently: connection panel)
      const target = state.panels.find((p) => p.id === action.id);
      if (target && !isPanelDeletable(target)) return state;
      return {
        ...state,
        panels: state.panels.filter((p) => p.id !== action.id),
        // Drop the closed panel from the selection so we don't leave a
        // dangling id pointing at a panel that no longer exists.
        selectedPanelIds: state.selectedPanelIds.filter(
          (id) => id !== action.id
        ),
        // Same for clusters: strip the id and auto-dissolve any cluster
        // that drops below MIN_CLUSTER_SIZE.
        clusters: stripFromClusters(state.clusters, new Set([action.id])),
      };
    }

    case "SET_SELECTION": {
      // Bail on no-op updates so React doesn't re-render every panel when
      // the marquee drags across empty space and hands us the same array.
      const next = action.panelIds;
      const prev = state.selectedPanelIds;
      if (
        next.length === prev.length &&
        next.every((id, i) => id === prev[i])
      ) {
        return state;
      }
      return { ...state, selectedPanelIds: next };
    }

    case "APPEND_MESSAGE":
      return {
        ...state,
        panels: state.panels.map((p) =>
          p.id === action.panelId && p.type === "chat"
            ? { ...p, messages: [...p.messages, action.message] }
            : p
        ),
      };

    case "UPDATE_STREAMING_MESSAGE":
      return {
        ...state,
        panels: state.panels.map((p) => {
          if (p.id !== action.panelId || p.type !== "chat") return p;
          const last = p.messages[p.messages.length - 1];
          if (last && last.role === "ai" && last.type === "streaming") {
            const updated = [...p.messages];
            updated[updated.length - 1] = {
              role: "ai",
              type: "streaming",
              content: action.content,
            };
            return { ...p, messages: updated };
          }
          // No streaming bubble yet — append one.
          return {
            ...p,
            messages: [
              ...p.messages,
              { role: "ai", type: "streaming", content: action.content },
            ],
          };
        }),
      };

    case "FINALISE_STREAMING_MESSAGE":
      return {
        ...state,
        panels: state.panels.map((p) => {
          if (p.id !== action.panelId || p.type !== "chat") return p;
          const last = p.messages[p.messages.length - 1];
          if (!last || last.role !== "ai" || last.type !== "streaming") {
            return p;
          }
          const updated = [...p.messages];
          updated[updated.length - 1] = {
            role: "ai",
            type: "text",
            content: action.content,
          };
          return { ...p, messages: updated };
        }),
      };

    case "UPDATE_PROGRESS":
      return {
        ...state,
        panels: state.panels.map((p) => {
          if (p.id !== action.panelId || p.type !== "chat") return p;
          // Find the most recent progress message for this entryId and append
          const idx = findLastIndex(
            p.messages,
            (m) =>
              m.role === "ai" &&
              m.type === "progress" &&
              m.entryId === action.entryId
          );
          if (idx === -1) return p;
          const msg = p.messages[idx];
          if (msg.type !== "progress") return p;
          const updatedMessages = [...p.messages];
          updatedMessages[idx] = {
            ...msg,
            events: [...msg.events, action.event],
            status:
              action.event.type === "complete"
                ? "complete"
                : action.event.type === "error"
                  ? "error"
                  : "streaming",
          };
          return { ...p, messages: updatedMessages };
        }),
      };

    case "SET_PROCESSING":
      return {
        ...state,
        panels: state.panels.map((p) =>
          p.id === action.panelId && p.type === "chat"
            ? {
                ...p,
                isProcessing: action.isProcessing,
                activeEntryId: action.activeEntryId,
              }
            : p
        ),
      };

    case "ADD_ARTIFACTS":
      return {
        ...state,
        panels: state.panels.map((p) => {
          if (p.id !== action.panelId || p.type !== "chat") return p;
          const artifactsMessage: ChatMessage = {
            role: "ai",
            type: "artifacts",
            entryId: action.entryId,
            title: action.title,
            readme: action.readme,
            agentsMd: action.agentsMd,
            manifest: action.manifest,
          };
          return { ...p, messages: [...p.messages, artifactsMessage] };
        }),
      };

    case "SET_CONNECTION_API_KEY":
      return {
        ...state,
        panels: state.panels.map((p) =>
          p.id === action.panelId && p.type === "connection"
            ? { ...p, apiKey: action.apiKey }
            : p
        ),
      };

    case "SPAWN_ENTRY_PANEL": {
      // Position: caller override → right-of-source → camera center.
      const source = state.panels.find((p) => p.id === action.sourcePanelId);

      let x: number;
      let y: number;
      if (action.position) {
        // Ingestion panel replacement — take over the exact slot.
        x = action.position.x;
        y = action.position.y;
      } else if (source) {
        x = source.x + source.width + 32;
        y = source.y;
      } else {
        // Fallback — camera center. `window` may be undefined during SSR,
        // but the reducer only runs after hydration, so it's safe to read.
        const vw = typeof window !== "undefined" ? window.innerWidth : 1440;
        const vh = typeof window !== "undefined" ? window.innerHeight : 900;
        const pos = computeNewPanelPosition(
          state,
          vw,
          vh,
          ENTRY_PANEL_SIZE.width,
          ENTRY_PANEL_SIZE.height
        );
        x = pos.x;
        y = pos.y;
      }

      const newPanelId = `entry-${state.nextPanelId}`;
      const newPanel: EntryPanelData = {
        id: newPanelId,
        type: "entry",
        x,
        y,
        width: ENTRY_PANEL_SIZE.width,
        height: ENTRY_PANEL_SIZE.height,
        entryId: action.entryId,
        title: action.title,
        summary: action.summary,
        sourceUrl: action.sourceUrl,
        sourcePlatform: action.sourcePlatform,
        sourceAuthor: action.sourceAuthor,
        thumbnailUrl: action.thumbnailUrl,
        useCase: action.useCase,
        complexity: action.complexity,
        tags: action.tags,
        readme: action.readme,
        agentsMd: action.agentsMd,
        manifest: action.manifest,
        sourceChatPanelId: action.sourcePanelId,
        createdAt: new Date().toISOString(),
      };

      // Cluster auto-join: if the source panel was in a cluster, the new
      // entry joins the same cluster so ingestion output stays grouped
      // with the thread of work that produced it.
      const sourceCluster = state.clusters.find((c) =>
        c.panelIds.includes(action.sourcePanelId)
      );
      const nextClusters = sourceCluster
        ? state.clusters.map((c) =>
            c.id === sourceCluster.id
              ? { ...c, panelIds: [...c.panelIds, newPanelId] }
              : c
          )
        : state.clusters;

      return {
        ...state,
        panels: [...state.panels, newPanel],
        clusters: nextClusters,
        nextPanelId: state.nextPanelId + 1,
      };
    }

    case "CREATE_CLUSTER": {
      // Apply the moves atomically with the cluster creation so the outline
      // never flashes in the pre-layout positions.
      const moveMap = new Map(action.moves.map((m) => [m.id, m]));
      const movedPanels = state.panels.map((p) => {
        const move = moveMap.get(p.id);
        return move ? { ...p, x: move.x, y: move.y } : p;
      });

      // Enforce one-cluster-per-panel: strip the new members from any
      // pre-existing clusters before appending the new one.
      const newMemberSet = new Set(action.cluster.panelIds);
      const withoutDuplicates = stripFromClusters(state.clusters, newMemberSet);

      return {
        ...state,
        panels: movedPanels,
        clusters: [...withoutDuplicates, action.cluster],
        nextClusterId: state.nextClusterId + 1,
      };
    }

    case "DELETE_CLUSTER":
      return {
        ...state,
        clusters: state.clusters.filter((c) => c.id !== action.clusterId),
      };

    case "UPDATE_CLUSTER_NAME":
      return {
        ...state,
        clusters: state.clusters.map((c) =>
          c.id === action.clusterId ? { ...c, name: action.name } : c
        ),
      };

    case "UPDATE_CLUSTER_DB_INFO":
      return {
        ...state,
        clusters: state.clusters.map((c) =>
          c.id === action.clusterId
            ? { ...c, dbId: action.dbId, slug: action.slug }
            : c
        ),
      };

    case "ADD_PANEL_TO_CLUSTER": {
      // Enforce one-cluster-per-panel. Strip from any other cluster
      // (auto-dissolving anything that falls below MIN_CLUSTER_SIZE)
      // and append to the target. Preserve the target cluster's name
      // and createdAt — joining is a membership bump, not a re-cluster.
      const strippedClusters = stripFromClusters(
        state.clusters,
        new Set([action.panelId])
      );
      const target = strippedClusters.find((c) => c.id === action.clusterId);
      if (!target) {
        // Target cluster no longer exists (was auto-dissolved during
        // strip, e.g. the panel was its second-to-last member). No-op.
        return { ...state, clusters: strippedClusters };
      }
      if (target.panelIds.includes(action.panelId)) {
        return { ...state, clusters: strippedClusters };
      }
      return {
        ...state,
        clusters: strippedClusters.map((c) =>
          c.id === action.clusterId
            ? { ...c, panelIds: [...c.panelIds, action.panelId] }
            : c
        ),
      };
    }

    case "REMOVE_PANEL_FROM_CLUSTER":
      return {
        ...state,
        clusters: stripFromClusters(
          state.clusters,
          new Set([action.panelId])
        ),
      };

    case "CREATE_INGESTION_PANEL": {
      const newPanel: IngestionPanelData = {
        id: action.id,
        type: "ingestion",
        x: action.x,
        y: action.y,
        width: INGESTION_PANEL_SIZE.width,
        height: INGESTION_PANEL_SIZE.height,
        url: "",
        status: "idle",
        logs: [],
        entryId: null,
        errorMessage: null,
      };
      return {
        ...state,
        panels: [...state.panels, newPanel],
        nextPanelId: state.nextPanelId + 1,
      };
    }

    case "CREATE_BROWSE_PANEL": {
      const newPanel: BrowsePanelData = {
        id: action.id,
        type: "browse",
        x: action.x,
        y: action.y,
        width: BROWSE_PANEL_SIZE.width,
        height: BROWSE_PANEL_SIZE.height,
      };
      return {
        ...state,
        panels: [...state.panels, newPanel],
        nextPanelId: state.nextPanelId + 1,
      };
    }

    case "UPDATE_INGESTION_STATE":
      return {
        ...state,
        panels: state.panels.map((p) =>
          p.id === action.panelId && p.type === "ingestion"
            ? { ...p, ...action.patch }
            : p
        ),
      };

    default:
      return state;
  }
}

// Polyfill for Array.findLastIndex (Node 18 / older browsers may not support)
function findLastIndex<T>(arr: T[], pred: (item: T) => boolean): number {
  for (let i = arr.length - 1; i >= 0; i--) {
    if (pred(arr[i])) return i;
  }
  return -1;
}

// ── Context ────────────────────────────────────────────────────────

interface CanvasContextValue {
  state: CanvasState;
  dispatch: Dispatch<CanvasAction>;
}

const CanvasContext = createContext<CanvasContextValue | null>(null);

/**
 * Ref-based context for non-rendering reads of canvas state.
 * The ref object identity never changes, so consumers subscribing to this
 * context never re-render from it. Use this for imperative code (drag
 * handlers, cluster membership) that needs the latest state without
 * triggering a React re-render.
 */
const CanvasStateRefContext = createContext<MutableRefObject<CanvasState> | null>(null);

export function useCanvas(): CanvasContextValue {
  const ctx = useContext(CanvasContext);
  if (!ctx) {
    throw new Error("useCanvas must be used inside <CanvasProvider>");
  }
  return ctx;
}

/**
 * Returns a stable ref that always points to the latest CanvasState.
 * Reading `.current` in event handlers gives the freshest state without
 * causing the consuming component to re-render on state changes.
 */
export function useCanvasStateRef(): MutableRefObject<CanvasState> {
  const ref = useContext(CanvasStateRefContext);
  if (!ref) {
    throw new Error("useCanvasStateRef must be used inside <CanvasProvider>");
  }
  return ref;
}

// ── Provider ───────────────────────────────────────────────────────

function buildDefaultConnectionPanel(id: string): ConnectionPanelData {
  return {
    id,
    type: "connection",
    // Default position: top-left of the world, with a small inset so it
    // doesn't sit flush against the navbar.
    x: 40,
    y: 40,
    width: CONNECTION_PANEL_SIZE.width,
    height: CONNECTION_PANEL_SIZE.height,
    apiKey: null,
  };
}

/**
 * Ensure exactly one connection panel exists. If none, append one with a
 * fresh id and bump nextPanelId. This makes the connection panel a hard
 * singleton — auto-spawned on first load and re-injected for any existing
 * saved canvas that pre-dates this feature.
 */
function ensureConnectionPanel(state: CanvasState): CanvasState {
  if (state.panels.some((p) => p.type === "connection")) return state;
  const id = `connection-${state.nextPanelId}`;
  return {
    ...state,
    panels: [...state.panels, buildDefaultConnectionPanel(id)],
    nextPanelId: state.nextPanelId + 1,
  };
}

/**
 * Backward compat: pre-zoom canvases saved `camera: { x, y }` without zoom.
 * Inject zoom=1 so the reducer's multiplicative math doesn't produce NaN.
 */
function migratePreZoomCamera(state: CanvasState): CanvasState {
  if (typeof state.camera.zoom === "number") return state;
  return {
    ...state,
    camera: { ...state.camera, zoom: 1 },
  };
}

/**
 * Backward compat for the selection model:
 *  - Pre-selection canvases (oldest): neither field exists → inject
 *    `selectedPanelIds: []`.
 *  - Single-select era: `selectedPanelId: string | null` exists but no
 *    `selectedPanelIds` → convert to array form and drop the old field.
 *  - Multi-select (current): `selectedPanelIds: string[]` present → noop.
 */
function migrateMissingSelection(state: CanvasState): CanvasState {
  // We deliberately loosen the type here because old localStorage blobs
  // can pre-date fields the TS type now requires.
  const s = state as Partial<CanvasState> & { selectedPanelId?: string | null };

  if (Array.isArray(s.selectedPanelIds)) return state;

  if ("selectedPanelId" in s) {
    const next = { ...state, selectedPanelIds: s.selectedPanelId ? [s.selectedPanelId] : [] };
    delete (next as Partial<CanvasState> & { selectedPanelId?: string | null }).selectedPanelId;
    return next;
  }

  return { ...state, selectedPanelIds: [] };
}

/**
 * Backward compat for the cluster model (schema v1 → v2):
 *  - v1 saves have no `clusters` and no `nextClusterId` — inject both.
 *  - v2 saves already have them — noop.
 * Also bumps the stored `version` field so subsequent loads see v2 directly.
 */
function migrateAddClusters(state: CanvasState): CanvasState {
  const s = state as Partial<CanvasState>;
  if (Array.isArray(s.clusters) && typeof s.nextClusterId === "number") {
    return { ...state, version: 2 };
  }
  return {
    ...state,
    version: 2,
    clusters: Array.isArray(s.clusters) ? s.clusters : [],
    nextClusterId:
      typeof s.nextClusterId === "number" ? s.nextClusterId : 1,
  };
}

function loadInitialState(): CanvasState {
  if (typeof window === "undefined") {
    return ensureConnectionPanel(INITIAL_CANVAS_STATE);
  }
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return ensureConnectionPanel(INITIAL_CANVAS_STATE);
    // Parse loosely — the TS CanvasState type is narrow (version: 2) but
    // localStorage can still hold a pre-migration v1 blob. Omit the
    // version field from CanvasState so TS doesn't collapse back to 2.
    const parsed = JSON.parse(raw) as unknown as Omit<CanvasState, "version"> & {
      version: number;
    };
    if (parsed.version !== 1 && parsed.version !== 2) {
      return ensureConnectionPanel(INITIAL_CANVAS_STATE);
    }
    return ensureConnectionPanel(
      migrateAddClusters(
        migrateMissingSelection(migratePreZoomCamera(parsed as CanvasState))
      )
    );
  } catch {
    return ensureConnectionPanel(INITIAL_CANVAS_STATE);
  }
}

interface CanvasProviderProps {
  children: ReactNode;
}

export function CanvasProvider({ children }: CanvasProviderProps) {
  // useReducer with lazy initializer for SSR-safe hydration on first client mount
  const [state, dispatch] = useReducer(reducer, undefined, loadInitialState);

  // Stable ref that always points to the latest state. Provided via
  // CanvasStateRefContext so memoised children (e.g. CanvasPanel) can read
  // the latest state in event handlers without subscribing to re-renders.
  const stateRef = useRef<CanvasState>(state);
  useEffect(() => {
    stateRef.current = state;
  }, [state]);

  // Debounced persistence on every state change
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => {
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
      } catch {
        // localStorage may be full or unavailable; ignore
      }
    }, SAVE_DEBOUNCE_MS);
    return () => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    };
  }, [state]);

  return (
    <CanvasContext.Provider value={{ state, dispatch }}>
      <CanvasStateRefContext.Provider value={stateRef}>
        <CanvasSyncBridge />
        {children}
      </CanvasStateRefContext.Provider>
    </CanvasContext.Provider>
  );
}

/** Tiny bridge component so useCanvasSync can call useCanvas() inside the provider. */
function CanvasSyncBridge() {
  useCanvasSync();
  return null;
}

// ── Helpers exposed for components ─────────────────────────────────

/** Compute world coordinates for a new panel placed at the camera viewport center. */
export function computeNewPanelPosition(
  state: CanvasState,
  viewportWidth: number,
  viewportHeight: number,
  panelWidth: number,
  panelHeight: number
): { x: number; y: number } {
  // Invert the world→screen transform for the viewport center point:
  //   screen = world * zoom + camera  ⇒  world = (screen - camera) / zoom
  const { x: camX, y: camY, zoom } = state.camera;
  const worldX = (viewportWidth / 2 - camX) / zoom;
  const worldY = (viewportHeight / 2 - camY) / zoom;

  // Slight per-spawn offset so panels don't perfectly stack
  const spawnOffset = (state.nextPanelId % 8) * 24;

  return {
    x: Math.round(worldX - panelWidth / 2 + spawnOffset),
    y: Math.round(worldY - panelHeight / 2 + spawnOffset),
  };
}

/** Build the next panel ID as a string */
export function nextPanelIdString(state: CanvasState): string {
  return `panel-${state.nextPanelId}`;
}

// Re-export types for convenience
export type {
  Panel,
  ChatPanelData,
  EntryPanelData,
  CanvasState,
  CanvasAction,
};
export type { ChatMessage, ProgressEvent };

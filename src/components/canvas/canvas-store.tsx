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
  useMemo,
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
  ClusterBrainPanelData,
  ConnectionPanelData,
  EntryPanelData,
  Panel,
} from "./types";
import {
  BROWSE_PANEL_SIZE,
  CLUSTER_BRAIN_PANEL_SIZE,
  CONNECTION_PANEL_SIZE,
  ENTRY_PANEL_SIZE,
  MIN_CLUSTER_SIZE,
  isPanelDeletable,
} from "./types";
import type {
  ChatMessage,
  ProgressEvent,
} from "@/components/ingest/chat-message";
import { useCanvasDbSync } from "./use-canvas-db-sync";
import { useEntriesRealtime } from "./use-entries-realtime";
import { useClustersRealtime } from "./use-clusters-realtime";
import {
  useConversationSync,
  ChatConversationsProvider,
  type ServerConversation,
} from "./use-conversation-sync";
import { stripFromClusters } from "@/lib/canvas/defaults";

import { CANVAS_STORAGE_KEY_PREFIX, CANVAS_ACTIVE_USER_KEY } from "@/lib/config";
const SAVE_DEBOUNCE_MS = 500;

/** Build the user-scoped localStorage key for canvas state. */
function getStorageKey(userId?: string): string {
  const uid = userId || (typeof window !== "undefined" ? localStorage.getItem(CANVAS_ACTIVE_USER_KEY) : null);
  return uid ? `${CANVAS_STORAGE_KEY_PREFIX}:${uid}` : CANVAS_STORAGE_KEY_PREFIX;
}


// ── Cluster helpers ────────────────────────────────────────────────
// Shared with the server-side initial-state loader. See
// src/lib/canvas/defaults.ts for stripFromClusters / dedupSingletonPanels /
// ensureDefaultPanels — imported below.

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
        selectedPanelIds: state.selectedPanelIds.filter(
          (id) => id !== action.id
        ),
        clusters: stripFromClusters(state.clusters, new Set([action.id])),
      };
    }

    case "CLOSE_ENTRY_BY_ENTRY_ID": {
      const target = state.panels.find(
        (p) => p.type === "entry" && (p as EntryPanelData).entryId === action.entryId
      );
      if (!target) return state;
      return {
        ...state,
        panels: state.panels.filter((p) => p.id !== target.id),
        selectedPanelIds: state.selectedPanelIds.filter((id) => id !== target.id),
        clusters: stripFromClusters(state.clusters, new Set([target.id])),
      };
    }

    case "DELETE_SELECTED_PANELS": {
      const selectedIds = new Set(state.selectedPanelIds);
      if (selectedIds.size === 0) return state;

      const toDelete = state.panels.filter(
        (p) => selectedIds.has(p.id) && isPanelDeletable(p)
      );
      if (toDelete.length === 0) return state;

      const deleteIds = new Set(toDelete.map((p) => p.id));

      // Snapshot clusters that will dissolve so undo can restore them
      const newClusters = stripFromClusters(state.clusters, deleteIds);
      const dissolvedClusters = state.clusters.filter(
        (c) => !newClusters.some((nc) => nc.id === c.id)
      );

      return {
        ...state,
        panels: state.panels.filter((p) => !deleteIds.has(p.id)),
        selectedPanelIds: [],
        clusters: newClusters,
        deletedPanelsStack: [
          ...state.deletedPanelsStack.slice(-19), // cap at 20
          { panels: toDelete, clusters: dissolvedClusters },
        ],
      };
    }

    case "UNDO_DELETE": {
      const stack = state.deletedPanelsStack;
      if (stack.length === 0) return state;

      const last = stack[stack.length - 1];
      const restoredIds = last.panels.map((p) => p.id);

      // Restore dissolved clusters by merging them back
      const mergedClusters = [...state.clusters];
      for (const c of last.clusters) {
        const existing = mergedClusters.find((mc) => mc.id === c.id);
        if (existing) {
          // Cluster still exists but shrank — restore its member list
          existing.panelIds = c.panelIds;
        } else {
          mergedClusters.push(c);
        }
      }

      return {
        ...state,
        panels: [...state.panels, ...last.panels],
        selectedPanelIds: restoredIds,
        clusters: mergedClusters,
        deletedPanelsStack: stack.slice(0, -1),
      };
    }

    case "HYDRATE_CHAT_MESSAGES": {
      return {
        ...state,
        panels: state.panels.map((p) =>
          p.id === action.panelId && p.type === "chat"
            ? { ...p, messages: action.messages, conversationId: action.conversationId }
            : p
        ),
      };
    }

    case "UPDATE_CHAT_TITLE":
      return {
        ...state,
        panels: state.panels.map((p) =>
          p.id === action.panelId && p.type === "chat"
            ? { ...p, title: action.title }
            : p
        ),
      };

    case "SET_CHAT_PINNED":
      return {
        ...state,
        panels: state.panels.map((p) =>
          p.id === action.panelId && p.type === "chat"
            ? { ...p, pinned: action.pinned }
            : p
        ),
      };

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
      // Idempotency: skip if an entry panel with this entryId already exists
      if (state.panels.some((p) => p.type === "entry" && p.entryId === action.entryId)) {
        return state;
      }
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
        contentType: action.contentType || null,
        tags: action.tags,
        readme: action.readme,
        agentsMd: action.agentsMd,
        manifest: action.manifest,
        sourceChatPanelId: action.sourcePanelId,
        createdAt: new Date().toISOString(),
        readmeLoading: action.readmeLoading,
        agentsMdLoading: action.agentsMdLoading,
        tagsLoading: action.tagsLoading,
        isIngesting: action.isIngesting,
        isPendingIngestion: action.isPendingIngestion,
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

    case "UPDATE_ENTRY_ARTIFACT": {
      return {
        ...state,
        panels: state.panels.map((p) => {
          if (p.type !== "entry" || p.entryId !== action.entryId) return p;
          return {
            ...p,
            ...(action.readme !== undefined && { readme: action.readme, readmeLoading: false }),
            ...(action.agentsMd !== undefined && { agentsMd: action.agentsMd, agentsMdLoading: false }),
            ...(action.tags !== undefined && { tags: action.tags, tagsLoading: false }),
          };
        }),
      };
    }

    case "UPDATE_ENTRY_METADATA": {
      return {
        ...state,
        panels: state.panels.map((p) => {
          if (p.type !== "entry" || p.entryId !== action.entryId) return p;
          return {
            ...p,
            ...(action.title !== undefined && { title: action.title }),
            ...(action.summary !== undefined && { summary: action.summary }),
            ...(action.sourceUrl !== undefined && { sourceUrl: action.sourceUrl }),
            ...(action.sourcePlatform !== undefined && { sourcePlatform: action.sourcePlatform }),
            ...(action.sourceAuthor !== undefined && { sourceAuthor: action.sourceAuthor }),
            ...(action.thumbnailUrl !== undefined && { thumbnailUrl: action.thumbnailUrl }),
            ...(action.useCase !== undefined && { useCase: action.useCase }),
            ...(action.complexity !== undefined && { complexity: action.complexity }),
          };
        }),
      };
    }

    case "APPEND_INGESTION_LOG": {
      return {
        ...state,
        panels: state.panels.map((p) => {
          if (p.type !== "entry" || p.entryId !== action.entryId) return p;
          return {
            ...p,
            ingestionLogs: [...(p.ingestionLogs || []), action.event],
          };
        }),
      };
    }

    case "SET_ENTRY_INGESTING": {
      return {
        ...state,
        panels: state.panels.map((p) => {
          if (p.type !== "entry" || p.entryId !== action.entryId) return p;
          return {
            ...p,
            isIngesting: action.isIngesting,
            // Clear logs when ingestion ends
            ...(!action.isIngesting && { ingestionLogs: [] }),
          };
        }),
      };
    }

    case "SET_ENTRY_STATUS_FROM_REALTIME": {
      // Driven by the entries realtime subscription. Only touches the
      // two visual flags; leaves artifacts/metadata alone so an
      // in-flight ingestion render isn't clobbered. When the agent
      // finishes a prepare_ingest → submit flow, the resulting
      // complete-entry payload arrives via the existing SSE pipeline
      // (or a separate fetch on panel open), not this action.
      return {
        ...state,
        panels: state.panels.map((p) => {
          if (p.type !== "entry" || p.entryId !== action.entryId) return p;
          const next: typeof p = { ...p };
          if (action.isPendingIngestion !== undefined) {
            next.isPendingIngestion = action.isPendingIngestion;
          }
          if (action.isIngesting !== undefined) {
            next.isIngesting = action.isIngesting;
          }
          return next;
        }),
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

    case "UPDATE_CLUSTER_PUBLISHED_SLUG":
      return {
        ...state,
        clusters: state.clusters.map((c) =>
          c.id === action.clusterId
            ? { ...c, publishedSlug: action.publishedSlug }
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

    // ── Cluster brain panel actions ─────────────────────────────────

    case "CREATE_CLUSTER_BRAIN_PANEL": {
      const newPanel: ClusterBrainPanelData = {
        id: action.id,
        type: "cluster-brain",
        clusterId: action.clusterId,
        clusterName: action.clusterName,
        x: action.x,
        y: action.y,
        width: CLUSTER_BRAIN_PANEL_SIZE.width,
        height: CLUSTER_BRAIN_PANEL_SIZE.height,
        instructions: "",
        memories: [],
        status: action.initialStatus ?? "generating",
        errorMessage: null,
      };
      // Auto-join the brain panel to its cluster
      const updatedClusters = state.clusters.map((c) =>
        c.id === action.clusterId
          ? { ...c, panelIds: [...c.panelIds, action.id] }
          : c
      );
      return {
        ...state,
        panels: [...state.panels, newPanel],
        clusters: updatedClusters,
        nextPanelId: state.nextPanelId + 1,
      };
    }

    case "UPDATE_CLUSTER_BRAIN_INSTRUCTIONS":
      return {
        ...state,
        panels: state.panels.map((p) =>
          p.id === action.panelId && p.type === "cluster-brain"
            ? { ...p, instructions: action.instructions, status: "ready" as const, errorMessage: null }
            : p
        ),
      };

    case "UPDATE_CLUSTER_BRAIN_INSTRUCTIONS_TEXT":
      return {
        ...state,
        panels: state.panels.map((p) =>
          p.id === action.panelId && p.type === "cluster-brain"
            ? { ...p, instructions: action.instructions }
            : p
        ),
      };

    case "ADD_CLUSTER_BRAIN_MEMORY":
      return {
        ...state,
        panels: state.panels.map((p) =>
          p.id === action.panelId && p.type === "cluster-brain"
            ? { ...p, memories: [...p.memories, action.memory] }
            : p
        ),
      };

    case "REMOVE_CLUSTER_BRAIN_MEMORY":
      return {
        ...state,
        panels: state.panels.map((p) =>
          p.id === action.panelId && p.type === "cluster-brain"
            ? { ...p, memories: p.memories.filter((_, i) => i !== action.index) }
            : p
        ),
      };

    case "SET_CLUSTER_BRAIN_MEMORIES":
      return {
        ...state,
        panels: state.panels.map((p) =>
          p.id === action.panelId && p.type === "cluster-brain"
            ? { ...p, memories: action.memories }
            : p
        ),
      };

    case "SET_CLUSTER_BRAIN_ERROR":
      return {
        ...state,
        panels: state.panels.map((p) =>
          p.id === action.panelId && p.type === "cluster-brain"
            ? { ...p, status: "error" as const, errorMessage: action.errorMessage }
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
 * Separate context carrying only panels + clusters + dispatch.
 * Components that don't need camera can subscribe to this instead of
 * CanvasContext, avoiding re-renders on camera/zoom changes.
 */
interface PanelsContextValue {
  panels: Panel[];
  clusters: Cluster[];
  dispatch: Dispatch<CanvasAction>;
}
const PanelsContext = createContext<PanelsContextValue | null>(null);

/**
 * Ref-based context for non-rendering reads of canvas state.
 * The ref object identity never changes, so consumers subscribing to this
 * context never re-render from it. Use this for imperative code (drag
 * handlers, cluster membership) that needs the latest state without
 * triggering a React re-render.
 */
const CanvasStateRefContext = createContext<MutableRefObject<CanvasState> | null>(null);

/**
 * Capabilities — what the current viewer is allowed to do on this canvas.
 * The `/canvas` page always runs with everything enabled (default).
 * Read-only / shared-cluster views turn individual flags off.
 */
export interface CanvasCapabilities {
  canMove: boolean;
  canDelete: boolean;
  canAdd: boolean;
}

const DEFAULT_CAPABILITIES: CanvasCapabilities = {
  canMove: true,
  canDelete: true,
  canAdd: true,
};

const CapabilitiesContext = createContext<CanvasCapabilities>(DEFAULT_CAPABILITIES);

export function useCapabilities(): CanvasCapabilities {
  return useContext(CapabilitiesContext);
}

export function useCanvas(): CanvasContextValue {
  const ctx = useContext(CanvasContext);
  if (!ctx) {
    throw new Error("useCanvas must be used inside <CanvasProvider>");
  }
  return ctx;
}

/**
 * Subscribe to panels + clusters without re-rendering on camera changes.
 * Use this in fixed UI (e.g. FixedChatPanel) that doesn't need camera.
 */
export function usePanelsContext(): PanelsContextValue {
  const ctx = useContext(PanelsContext);
  if (!ctx) {
    throw new Error("usePanelsContext must be used inside <CanvasProvider>");
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

// ensureDefaultPanels / dedupSingletonPanels moved to
// src/lib/canvas/defaults.ts — shared with the server-side loader so the
// invariants hold regardless of entry point.

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

/**
 * How the canvas should persist state.
 *   "user"   → default. Writes to the user's canvas_panels / canvas_state /
 *              conversations tables via useCanvasDbSync + useConversationSync,
 *              plus localStorage write-through. Used by `/canvas`.
 *   "shared" → skip user tables. Mount a caller-supplied bridge via
 *              `onPanelsMove` that persists panel drags to a different
 *              endpoint (e.g. /api/community/[slug]/panels). Used by the
 *              shared-cluster viewer when the viewer is the owner.
 *   "none"   → read-only. No DB writes, no localStorage writes. Used when
 *              a non-owner visitor opens a shared cluster.
 *
 * CRITICAL: when a logged-in user views someone else's shared cluster, we
 * MUST NOT run in "user" mode — the sync hooks would overwrite their real
 * canvas_panels / canvas_state rows with the shared cluster's panels.
 */
export type CanvasSyncStrategy = "user" | "shared" | "none";

interface CanvasProviderProps {
  children: ReactNode;
  userId?: string;
  /**
   * Server-rendered canvas state. Fetched by the `/canvas` server
   * component (see src/app/canvas/page.tsx) and supplied here as a prop
   * so `useReducer` has real data on first render — no hydration step.
   */
  initialState: CanvasState;
  /** Server-rendered conversations list, paired with initialState. */
  initialConversations: ServerConversation[];
  /** Default "user" preserves existing `/canvas` behavior. */
  syncStrategy?: CanvasSyncStrategy;
  /**
   * What the current viewer is allowed to do. Omit on `/canvas` to get
   * the default (everything enabled). Shared / read-only views pass a
   * narrower set. See CanvasCapabilities.
   */
  capabilities?: CanvasCapabilities;
  /**
   * Called in "shared" sync mode whenever a drag-driven panel move
   * lands. Receives the final positions of every moved panel. The
   * caller (typically the shared-cluster page) forwards these to the
   * matching `/api/community/[slug]/panels` endpoint.
   * Ignored in "user" / "none" modes.
   */
  onPanelsMove?: (
    moves: Array<{ id: string; x: number; y: number }>
  ) => void;
}

export function CanvasProvider({
  children,
  userId,
  initialState,
  initialConversations,
  syncStrategy = "user",
  capabilities,
  onPanelsMove,
}: CanvasProviderProps) {
  const [state, dispatch] = useReducer(
    reducer,
    { userId, initialState },
    ({ userId: uid, initialState: init }) => {
      // Track the active user so add-to-canvas.ts (outside the canvas)
      // can find the right localStorage key for its write-through cache.
      if (typeof window !== "undefined" && uid) {
        localStorage.setItem(CANVAS_ACTIVE_USER_KEY, uid);
      }
      return init;
    }
  );

  const stateRef = useRef<CanvasState>(state);
  useEffect(() => {
    stateRef.current = state;
  }, [state]);

  // Debounced write-through cache to localStorage. Still useful for
  // add-to-canvas.ts (operates outside the canvas page) and as a
  // backup, but never read on mount.
  //
  // CRITICAL: skip this entirely for shared / read-only views — the
  // shared cluster's panels would otherwise overwrite the logged-in
  // user's real canvas state the next time they open /canvas.
  const storageKey = getStorageKey(userId);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (syncStrategy !== "user") return;
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => {
      try {
        const { deletedPanelsStack: _, ...persistable } = state;
        localStorage.setItem(storageKey, JSON.stringify(persistable));
      } catch {
        // localStorage may be full or unavailable; ignore
      }
    }, SAVE_DEBOUNCE_MS);
    return () => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    };
  }, [state, storageKey, syncStrategy]);

  const panelsCtx = useMemo(
    () => ({ panels: state.panels, clusters: state.clusters, dispatch }),
    [state.panels, state.clusters, dispatch]
  );

  const effectiveCapabilities = capabilities ?? DEFAULT_CAPABILITIES;

  return (
    <CanvasContext.Provider value={{ state, dispatch }}>
      <PanelsContext.Provider value={panelsCtx}>
        <CanvasStateRefContext.Provider value={stateRef}>
          <CapabilitiesContext.Provider value={effectiveCapabilities}>
            <ChatConversationsProvider initialConversations={initialConversations}>
              {syncStrategy === "user" && <CanvasDbSyncBridge />}
              {syncStrategy === "user" && <ConversationSyncBridge />}
              {syncStrategy === "user" && <EntriesRealtimeBridge />}
              {syncStrategy === "user" && <ClustersRealtimeBridge />}
              {syncStrategy === "shared" && (
                <SharedPanelMoveBridge onPanelsMove={onPanelsMove} />
              )}
              {children}
            </ChatConversationsProvider>
          </CapabilitiesContext.Provider>
        </CanvasStateRefContext.Provider>
      </PanelsContext.Provider>
    </CanvasContext.Provider>
  );
}

/** Bridge for DB-backed canvas state sync (write-through only). */
function CanvasDbSyncBridge() {
  useCanvasDbSync();
  return null;
}

/** Bridge for conversation persistence — saves chat messages to Supabase. */
function ConversationSyncBridge() {
  useConversationSync();
  return null;
}

/**
 * Bridge for realtime updates to `entries` rows the user owns. Flips
 * amber pending tiles to the ingesting state (and on to complete) live
 * when the user's MCP agent claims and finishes them.
 */
function EntriesRealtimeBridge() {
  useEntriesRealtime();
  return null;
}

/**
 * Bridge for realtime updates to clusters, brains, and brain memories.
 * Reflects MCP-agent edits (rename / delete / brain update / memory
 * write) on the canvas without a page reload.
 */
function ClustersRealtimeBridge() {
  useClustersRealtime();
  return null;
}

/**
 * Shared-cluster sync bridge. Watches panel positions and forwards
 * debounced updates to an owner-supplied callback — no DB writes, no
 * localStorage writes. Used by the shared-cluster viewer when the
 * viewer is the cluster's owner and drags are persisted to
 * /api/community/[slug]/panels.
 */
function SharedPanelMoveBridge({
  onPanelsMove,
}: {
  onPanelsMove?: (moves: Array<{ id: string; x: number; y: number }>) => void;
}) {
  const { state } = useCanvas();
  const lastSentRef = useRef<Map<string, { x: number; y: number }>>(new Map());
  const initializedRef = useRef(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!onPanelsMove) return;

    // First run: seed the baseline from initial panel positions without
    // firing any moves. Previously this logic lived in a separate
    // empty-deps effect, but React runs effects in declaration order,
    // so the watcher would see an empty baseline on its first pass and
    // schedule a spurious "send everything" POST 500ms after mount.
    // Keeping both responsibilities in one effect fixes the ordering.
    if (!initializedRef.current) {
      const baseline = new Map<string, { x: number; y: number }>();
      for (const p of state.panels) baseline.set(p.id, { x: p.x, y: p.y });
      lastSentRef.current = baseline;
      initializedRef.current = true;
      return;
    }

    const moves: Array<{ id: string; x: number; y: number }> = [];
    for (const panel of state.panels) {
      const last = lastSentRef.current.get(panel.id);
      if (!last || last.x !== panel.x || last.y !== panel.y) {
        moves.push({ id: panel.id, x: panel.x, y: panel.y });
      }
    }

    if (moves.length === 0) return;

    // Debounce — mirrors the debounce useCanvasDbSync uses for position
    // updates so dragging doesn't spam the API on every frame.
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      // Record what we're about to send so the next diff is against
      // the post-send baseline.
      for (const m of moves) {
        lastSentRef.current.set(m.id, { x: m.x, y: m.y });
      }
      onPanelsMove(moves);
    }, 500);

    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [state.panels, onPanelsMove]);

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

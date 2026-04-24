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
} from "../types";
import {
  BROWSE_PANEL_SIZE,
  CLUSTER_BRAIN_PANEL_SIZE,
  CONNECTION_PANEL_SIZE,
  ENTRY_PANEL_SIZE,
  MIN_CLUSTER_SIZE,
  isPanelDeletable,
} from "../types";
import { stripFromClusters } from "@/features/canvas/server/defaults";
import type { ChatMessage } from "@/components/ingest/chat-message";
import { findNonOverlappingPosition, computeNewPanelPosition } from "./layout";

// ── Reducer ────────────────────────────────────────────────────────

export function reducer(state: CanvasState, action: CanvasAction): CanvasState {
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
      const { x, y } = findNonOverlappingPosition(
        action.x,
        action.y,
        480,
        600,
        state.panels
      );
      const newPanel: ChatPanelData = {
        id: action.id,
        type: "chat",
        x,
        y,
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
        // Skip overlap-avoidance: the panel being replaced still lives in
        // state at this point and would otherwise nudge the new one away
        // from its intended slot.
        x = action.position.x;
        y = action.position.y;
      } else if (source) {
        const preferred = findNonOverlappingPosition(
          source.x + source.width + 32,
          source.y,
          ENTRY_PANEL_SIZE.width,
          ENTRY_PANEL_SIZE.height,
          state.panels
        );
        x = preferred.x;
        y = preferred.y;
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
        const adjusted = findNonOverlappingPosition(
          pos.x,
          pos.y,
          ENTRY_PANEL_SIZE.width,
          ENTRY_PANEL_SIZE.height,
          state.panels
        );
        x = adjusted.x;
        y = adjusted.y;
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
      const { x, y } = findNonOverlappingPosition(
        action.x,
        action.y,
        BROWSE_PANEL_SIZE.width,
        BROWSE_PANEL_SIZE.height,
        state.panels
      );
      const newPanel: BrowsePanelData = {
        id: action.id,
        type: "browse",
        x,
        y,
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
      const { x, y } = findNonOverlappingPosition(
        action.x,
        action.y,
        CLUSTER_BRAIN_PANEL_SIZE.width,
        CLUSTER_BRAIN_PANEL_SIZE.height,
        state.panels
      );
      const newPanel: ClusterBrainPanelData = {
        id: action.id,
        type: "cluster-brain",
        clusterId: action.clusterId,
        clusterName: action.clusterName,
        x,
        y,
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

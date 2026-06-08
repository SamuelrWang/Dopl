import type {
  ArtifactPanelData,
  CanvasAction,
  CanvasState,
  ChatPanelData,
  KnowledgeBasePanelData,
  KnowledgePanelData,
  SkillPanelData,
  SkillsPanelData,
} from "../types";
import {
  ARTIFACT_PANEL_SIZE,
  KNOWLEDGE_BASE_PANEL_SIZE,
  KNOWLEDGE_PANEL_SIZE,
  SKILL_PANEL_SIZE,
  SKILLS_PANEL_SIZE,
  isPanelDeletable,
} from "../types";
import { stripFromClusters } from "@/features/canvas/server/defaults";
import { findNonOverlappingPosition } from "./layout";

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

    case "CREATE_KNOWLEDGE_PANEL": {
      const { x, y } = findNonOverlappingPosition(
        action.x,
        action.y,
        KNOWLEDGE_PANEL_SIZE.width,
        KNOWLEDGE_PANEL_SIZE.height,
        state.panels
      );
      const newPanel: KnowledgePanelData = {
        id: action.id,
        type: "knowledge",
        x,
        y,
        width: KNOWLEDGE_PANEL_SIZE.width,
        height: KNOWLEDGE_PANEL_SIZE.height,
      };
      return {
        ...state,
        panels: [...state.panels, newPanel],
        nextPanelId: state.nextPanelId + 1,
      };
    }

    case "CREATE_SKILLS_PANEL": {
      const { x, y } = findNonOverlappingPosition(
        action.x,
        action.y,
        SKILLS_PANEL_SIZE.width,
        SKILLS_PANEL_SIZE.height,
        state.panels
      );
      const newPanel: SkillsPanelData = {
        id: action.id,
        type: "skills",
        x,
        y,
        width: SKILLS_PANEL_SIZE.width,
        height: SKILLS_PANEL_SIZE.height,
      };
      return {
        ...state,
        panels: [...state.panels, newPanel],
        nextPanelId: state.nextPanelId + 1,
      };
    }

    case "CREATE_KNOWLEDGE_BASE_PANEL": {
      const { x, y } = findNonOverlappingPosition(
        action.x,
        action.y,
        KNOWLEDGE_BASE_PANEL_SIZE.width,
        KNOWLEDGE_BASE_PANEL_SIZE.height,
        state.panels
      );
      const newPanel: KnowledgeBasePanelData = {
        id: action.id,
        type: "knowledge-base",
        x,
        y,
        width: KNOWLEDGE_BASE_PANEL_SIZE.width,
        height: KNOWLEDGE_BASE_PANEL_SIZE.height,
        knowledgeBaseId: action.knowledgeBaseId,
        slug: action.slug,
        name: action.name,
        description: action.description,
        agentWriteEnabled: action.agentWriteEnabled,
      };
      return {
        ...state,
        panels: [...state.panels, newPanel],
        nextPanelId: state.nextPanelId + 1,
      };
    }

    case "CREATE_SKILL_PANEL": {
      const { x, y } = findNonOverlappingPosition(
        action.x,
        action.y,
        SKILL_PANEL_SIZE.width,
        SKILL_PANEL_SIZE.height,
        state.panels
      );
      const newPanel: SkillPanelData = {
        id: action.id,
        type: "skill",
        x,
        y,
        width: SKILL_PANEL_SIZE.width,
        height: SKILL_PANEL_SIZE.height,
        skillId: action.skillId,
        slug: action.slug,
        name: action.name,
        description: action.description,
        status: action.status,
      };
      return {
        ...state,
        panels: [...state.panels, newPanel],
        nextPanelId: state.nextPanelId + 1,
      };
    }

    case "CREATE_ARTIFACT_PANEL": {
      const { x, y } = findNonOverlappingPosition(
        action.x,
        action.y,
        ARTIFACT_PANEL_SIZE.width,
        ARTIFACT_PANEL_SIZE.height,
        state.panels
      );
      const newPanel: ArtifactPanelData = {
        id: action.id,
        type: "artifact",
        x,
        y,
        width: ARTIFACT_PANEL_SIZE.width,
        height: ARTIFACT_PANEL_SIZE.height,
        title: action.title,
        markdown: action.markdown,
        sourceConversationId: action.sourceConversationId,
        sourceMessageId: action.sourceMessageId,
      };
      return {
        ...state,
        panels: [...state.panels, newPanel],
        nextPanelId: state.nextPanelId + 1,
      };
    }

    case "UPDATE_ARTIFACT_MARKDOWN":
      return {
        ...state,
        panels: state.panels.map((p) =>
          p.id === action.panelId && p.type === "artifact"
            ? { ...p, markdown: action.markdown }
            : p
        ),
      };

    case "UPDATE_ARTIFACT_TITLE":
      return {
        ...state,
        panels: state.panels.map((p) =>
          p.id === action.panelId && p.type === "artifact"
            ? { ...p, title: action.title }
            : p
        ),
      };

    default:
      return state;
  }
}

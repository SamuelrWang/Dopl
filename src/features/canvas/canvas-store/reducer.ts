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
  NODE_PANEL_SIZE,
  SKILL_PANEL_SIZE,
  SKILLS_PANEL_SIZE,
  isPanelDeletable,
  nodeRefKey,
} from "../types";
import { stripFromClusters } from "@/features/canvas/server/defaults";
import { findNonOverlappingPosition } from "./layout";

// ── Reducer ────────────────────────────────────────────────────────

/**
 * Duplicate-id guard for panel creation. A stale persisted counter (or
 * a re-fired effect) can ask the reducer to mint an id that's already
 * on the canvas — admitting it would produce colliding React keys and
 * panel_data writes landing in the wrong row. Creation is refused
 * instead; callers treat it as a no-op.
 */
function panelIdTaken(state: CanvasState, id: string): boolean {
  const taken = state.panels.some((p) => p.id === id);
  if (taken) {
    console.warn(`[canvas] refused duplicate panel id ${id}`);
  }
  return taken;
}

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
      if (panelIdTaken(state, action.id)) return state;
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
        edges: state.edges.filter(
          (ed) => ed.fromPanelId !== action.id && ed.toPanelId !== action.id
        ),
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

      // Snapshot EVERY cluster the deletion touches (dissolved or merely
      // shrunk) so undo can restore membership — with the info-panel
      // survival rule, workflow clusters usually shrink instead of
      // dissolving, and a dissolve-only snapshot would lose membership.
      const newClusters = stripFromClusters(state.clusters, deleteIds);
      const touchedClusters = state.clusters.filter((c) =>
        c.panelIds.some((id) => deleteIds.has(id))
      );
      const removedEdges = state.edges.filter(
        (ed) => deleteIds.has(ed.fromPanelId) || deleteIds.has(ed.toPanelId)
      );

      return {
        ...state,
        panels: state.panels.filter((p) => !deleteIds.has(p.id)),
        selectedPanelIds: [],
        clusters: newClusters,
        edges: state.edges.filter(
          (ed) => !deleteIds.has(ed.fromPanelId) && !deleteIds.has(ed.toPanelId)
        ),
        deletedPanelsStack: [
          ...state.deletedPanelsStack.slice(-19), // cap at 20
          { panels: toDelete, clusters: touchedClusters, edges: removedEdges },
        ],
      };
    }

    case "UNDO_DELETE": {
      const stack = state.deletedPanelsStack;
      if (stack.length === 0) return state;

      const last = stack[stack.length - 1];
      const restoredIds = last.panels.map((p) => p.id);
      const restoredIdSet = new Set(restoredIds);

      // Panels that will exist after the restore — snapshot panelIds may
      // reference panels deleted in LATER operations; filter those out.
      const postPanelIds = new Set([
        ...state.panels.map((p) => p.id),
        ...restoredIds,
      ]);

      // Restore touched clusters: re-add restored members to shrunk
      // clusters (immutably — the old in-place mutation corrupted prior
      // state snapshots) and resurrect fully-dissolved ones.
      const mergedClusters = state.clusters.map((mc) => {
        const snapshot = last.clusters.find((c) => c.id === mc.id);
        if (!snapshot) return mc;
        const restoredMembers = snapshot.panelIds.filter(
          (id) => restoredIdSet.has(id) && !mc.panelIds.includes(id)
        );
        if (restoredMembers.length === 0) return mc;
        return { ...mc, panelIds: [...mc.panelIds, ...restoredMembers] };
      });
      for (const c of last.clusters) {
        if (mergedClusters.some((mc) => mc.id === c.id)) continue;
        mergedClusters.push({
          ...c,
          panelIds: c.panelIds.filter((id) => postPanelIds.has(id)),
        });
      }

      // Restore edges whose endpoints both exist post-restore (db-sync
      // re-POSTs them; ids are stable uuids).
      const existingEdgeIds = new Set(state.edges.map((e) => e.id));
      const restoredEdges = (last.edges ?? []).filter(
        (e) =>
          !existingEdgeIds.has(e.id) &&
          postPanelIds.has(e.fromPanelId) &&
          postPanelIds.has(e.toPanelId)
      );

      return {
        ...state,
        panels: [...state.panels, ...last.panels],
        selectedPanelIds: restoredIds,
        clusters: mergedClusters,
        edges: [...state.edges, ...restoredEdges],
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

    case "DELETE_CLUSTER": {
      // The cluster-info panel's lifecycle is the cluster's — remove it
      // together so no orphaned header card floats on the canvas.
      const cluster = state.clusters.find((c) => c.id === action.clusterId);
      const infoId = cluster?.infoPanelId;
      return {
        ...state,
        panels: infoId
          ? state.panels.filter((p) => p.id !== infoId)
          : state.panels,
        selectedPanelIds: infoId
          ? state.selectedPanelIds.filter((id) => id !== infoId)
          : state.selectedPanelIds,
        clusters: state.clusters.filter((c) => c.id !== action.clusterId),
        edges: infoId
          ? state.edges.filter(
              (ed) => ed.fromPanelId !== infoId && ed.toPanelId !== infoId
            )
          : state.edges,
      };
    }

    case "CREATE_CLUSTER_WORKFLOW": {
      if (panelIdTaken(state, action.infoPanel.id)) return state;
      // Workflow creation: the cluster, its info panel, and any layout
      // moves land in one reducer step so the outline + header card
      // appear together (never a flash of the pre-layout positions).
      const moveMap = new Map((action.moves ?? []).map((m) => [m.id, m]));
      const movedPanels = state.panels.map((p) => {
        const move = moveMap.get(p.id);
        return move ? { ...p, x: move.x, y: move.y } : p;
      });
      const newMemberSet = new Set(action.cluster.panelIds);
      const withoutDuplicates = stripFromClusters(state.clusters, newMemberSet);
      return {
        ...state,
        panels: [...movedPanels, action.infoPanel],
        clusters: [...withoutDuplicates, action.cluster],
        nextClusterId: state.nextClusterId + 1,
        nextPanelId: state.nextPanelId + 1,
      };
    }

    case "CLUSTER_ATTACH_INFO_PANEL": {
      // Upgrade-in-place: synthesize the info panel for a pre-workflow
      // cluster. No-ops if the cluster already has one (or is gone).
      const cluster = state.clusters.find((c) => c.id === action.clusterId);
      if (!cluster) return state;
      // No-op only when the recorded info panel actually EXISTS — a
      // stale infoPanelId (panel row lost) must not block re-synthesis,
      // or the cluster becomes permanently headerless (unrenamable,
      // undeletable from the canvas).
      const infoPanelAlive =
        cluster.infoPanelId != null &&
        state.panels.some((p) => p.id === cluster.infoPanelId);
      if (infoPanelAlive) return state;
      if (state.panels.some((p) => p.id === action.panel.id)) return state;
      return {
        ...state,
        panels: [...state.panels, action.panel],
        clusters: state.clusters.map((c) =>
          c.id === action.clusterId
            ? {
                ...c,
                infoPanelId: action.panel.id,
                panelIds: [...c.panelIds, action.panel.id],
              }
            : c
        ),
        nextPanelId: state.nextPanelId + 1,
      };
    }

    case "UPDATE_CLUSTER_INFO":
      return {
        ...state,
        clusters: state.clusters.map((c) =>
          c.id === action.clusterId
            ? {
                ...c,
                ...(action.name !== undefined ? { name: action.name } : null),
                ...(action.description !== undefined
                  ? { description: action.description }
                  : null),
              }
            : c
        ),
      };

    case "CREATE_NODE_PANEL": {
      if (panelIdTaken(state, action.id)) return state;
      const { x, y } = findNonOverlappingPosition(
        action.x,
        action.y,
        NODE_PANEL_SIZE.width,
        NODE_PANEL_SIZE.height,
        state.panels
      );
      return {
        ...state,
        panels: [
          ...state.panels,
          {
            id: action.id,
            type: "node",
            x,
            y,
            width: NODE_PANEL_SIZE.width,
            height: NODE_PANEL_SIZE.height,
            title: "",
            description: "",
            reads: [],
            actions: [],
            userInput: "",
            agentOutput: "",
            nextInstructions: "",
          },
        ],
        nextPanelId: state.nextPanelId + 1,
      };
    }

    case "UPDATE_NODE_FIELDS":
      return {
        ...state,
        panels: state.panels.map((p) =>
          p.id === action.panelId && p.type === "node"
            ? { ...p, ...action.patch }
            : p
        ),
      };

    case "NODE_DOCK_REF":
      return {
        ...state,
        panels: state.panels.map((p) => {
          if (p.id !== action.panelId || p.type !== "node") return p;
          const field = action.zone === "read" ? "reads" : "actions";
          const existing = p[field];
          if (existing.some((r) => nodeRefKey(r) === nodeRefKey(action.ref))) {
            return p;
          }
          return { ...p, [field]: [...existing, action.ref] };
        }),
      };

    case "NODE_UNDOCK_REF":
      return {
        ...state,
        panels: state.panels.map((p) => {
          if (p.id !== action.panelId || p.type !== "node") return p;
          const field = action.zone === "read" ? "reads" : "actions";
          return {
            ...p,
            [field]: p[field].filter((r) => nodeRefKey(r) !== action.refKey),
          };
        }),
      };

    case "EDGE_ADD": {
      const exists = state.edges.some(
        (ed) =>
          ed.fromPanelId === action.edge.fromPanelId &&
          ed.toPanelId === action.edge.toPanelId
      );
      if (exists || action.edge.fromPanelId === action.edge.toPanelId) {
        return state;
      }
      return { ...state, edges: [...state.edges, action.edge] };
    }

    case "EDGE_REMOVE":
      return {
        ...state,
        edges: state.edges.filter((ed) => ed.id !== action.edgeId),
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
      if (panelIdTaken(state, action.id)) return state;
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
      if (panelIdTaken(state, action.id)) return state;
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
      if (panelIdTaken(state, action.id)) return state;
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
      if (panelIdTaken(state, action.id)) return state;
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
      if (panelIdTaken(state, action.id)) return state;
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

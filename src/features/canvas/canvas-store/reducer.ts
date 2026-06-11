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

/**
 * Counter value after creating a panel with `id`. For `panel-N` ids the
 * counter jumps past N — call sites mint FREE ids that can sit ahead of
 * a lagging counter (see nextPanelIdString), and a plain `+ 1` would
 * leave the counter pointing at a taken suffix, turning every later
 * create into a panelIdTaken no-op. Non-`panel-N` ids (e.g.
 * `artifact-<uuid>`) keep the legacy `+ 1`.
 */
function counterAfterMint(state: CanvasState, id: string): number {
  const m = /^panel-(\d+)$/.exec(id);
  return m
    ? Math.max(state.nextPanelId, Number(m[1])) + 1
    : state.nextPanelId + 1;
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
        nextPanelId: counterAfterMint(state, action.id),
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

      const removedEdges = state.edges.filter(
        (ed) => deleteIds.has(ed.fromPanelId) || deleteIds.has(ed.toPanelId)
      );

      return {
        ...state,
        panels: state.panels.filter((p) => !deleteIds.has(p.id)),
        selectedPanelIds: [],
        edges: state.edges.filter(
          (ed) => !deleteIds.has(ed.fromPanelId) && !deleteIds.has(ed.toPanelId)
        ),
        deletedPanelsStack: [
          ...state.deletedPanelsStack.slice(-19), // cap at 20
          { panels: toDelete, edges: removedEdges },
        ],
      };
    }

    case "UNDO_DELETE": {
      const stack = state.deletedPanelsStack;
      if (stack.length === 0) return state;

      const last = stack[stack.length - 1];
      const restoredIds = last.panels.map((p) => p.id);

      // Panels that will exist after the restore.
      const postPanelIds = new Set([
        ...state.panels.map((p) => p.id),
        ...restoredIds,
      ]);

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

    case "CREATE_WORKFLOW": {
      if (panelIdTaken(state, action.panel.id)) return state;
      return {
        ...state,
        panels: [...state.panels, action.panel],
        nextPanelId: counterAfterMint(state, action.panel.id),
      };
    }

    case "UPDATE_WORKFLOW_INFO":
      return {
        ...state,
        panels: state.panels.map((p) =>
          p.id === action.panelId && p.type === "workflow"
            ? {
                ...p,
                ...(action.name !== undefined ? { name: action.name } : null),
                ...(action.description !== undefined
                  ? { description: action.description }
                  : null),
              }
            : p
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
        nextPanelId: counterAfterMint(state, action.id),
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
      // Reject the exact pair AND the reverse pair: A→B and B→A render
      // as pixel-identical overlapping curves (facing-anchor geometry is
      // symmetric), so the "second" edge just makes deletion look broken
      // — and membership reachability is undirected anyway.
      const exists = state.edges.some(
        (ed) =>
          (ed.fromPanelId === action.edge.fromPanelId &&
            ed.toPanelId === action.edge.toPanelId) ||
          (ed.fromPanelId === action.edge.toPanelId &&
            ed.toPanelId === action.edge.fromPanelId)
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
        nextPanelId: counterAfterMint(state, action.id),
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
        nextPanelId: counterAfterMint(state, action.id),
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
        nextPanelId: counterAfterMint(state, action.id),
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
        nextPanelId: counterAfterMint(state, action.id),
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
        nextPanelId: counterAfterMint(state, action.id),
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

    case "APPLY_REMOTE_PANEL_UPSERT": {
      const incoming = action.panel;
      const exists = state.panels.some((p) => p.id === incoming.id);
      if (!exists) {
        return { ...state, panels: [...state.panels, incoming] };
      }
      // Don't clobber a panel the user has selected (likely dragging or
      // editing its text) — a debounced echo of an older value would snap
      // it back.
      if (state.selectedPanelIds.includes(incoming.id)) return state;
      return {
        ...state,
        panels: state.panels.map((p) => (p.id === incoming.id ? incoming : p)),
      };
    }

    case "APPLY_REMOTE_PANEL_REMOVE": {
      if (!state.panels.some((p) => p.id === action.panelId)) return state;
      return {
        ...state,
        panels: state.panels.filter((p) => p.id !== action.panelId),
        selectedPanelIds: state.selectedPanelIds.filter(
          (id) => id !== action.panelId
        ),
        edges: state.edges.filter(
          (e) =>
            e.fromPanelId !== action.panelId && e.toPanelId !== action.panelId
        ),
      };
    }

    case "APPLY_REMOTE_EDGE_UPSERT": {
      const dup = state.edges.some(
        (e) =>
          e.id === action.edge.id ||
          (e.fromPanelId === action.edge.fromPanelId &&
            e.toPanelId === action.edge.toPanelId)
      );
      if (dup) return state;
      return { ...state, edges: [...state.edges, action.edge] };
    }

    case "APPLY_REMOTE_EDGE_REMOVE": {
      if (!state.edges.some((e) => e.id === action.edgeId)) return state;
      return {
        ...state,
        edges: state.edges.filter((e) => e.id !== action.edgeId),
      };
    }

    default:
      return state;
  }
}

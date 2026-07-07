/**
 * Canvas + panel type definitions.
 *
 * The canvas is an infinite world. Panels live at world coordinates;
 * the camera offset translates world → screen for rendering.
 */

export interface BasePanelData {
  id: string;
  /** World coordinates (top-left of the panel box) */
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * ConnectionPanelData — singleton panel that holds the user's API key
 * and shows the MCP / cURL connection details. Auto-spawned on first load,
 * cannot be deleted, only one of these exists at a time.
 */
export interface ConnectionPanelData extends BasePanelData {
  type: "connection";
}

/**
 * KnowledgePanelData — workspace-scoped knowledge-bases browser. Hardcoded UI
 * for now; will sync with /api/knowledge/* in a later pass.
 */
export interface KnowledgePanelData extends BasePanelData {
  type: "knowledge";
}

/**
 * SkillsPanelData — workspace-scoped skills browser. Hardcoded UI for now;
 * will sync with /api/skills/* in a later pass.
 */
export interface SkillsPanelData extends BasePanelData {
  type: "skills";
}

/**
 * KnowledgeBasePanelData — a single knowledge base in panel form, suitable
 * for joining clusters. Spawned by clicking a card in the workspace
 * KnowledgePanel browser. Hardcoded UI for now; the `knowledgeBaseId` /
 * `slug` are the future hooks for real data.
 */
export interface KnowledgeBasePanelData extends BasePanelData {
  type: "knowledge-base";
  knowledgeBaseId: string;
  slug: string;
  name: string;
  description: string | null;
  agentWriteEnabled: boolean;
}

/**
 * SkillPanelData — a single skill in panel form, suitable for joining
 * clusters. Spawned by clicking a row in the workspace SkillsPanel browser.
 */
export interface SkillPanelData extends BasePanelData {
  type: "skill";
  skillId: string;
  slug: string;
  name: string;
  description: string;
  status: "active" | "draft";
}

/**
 * ArtifactPanelData — workspace-shared markdown document panel. Editable
 * in place via the same MarkdownMessage renderer the rest of the app uses.
 */
export interface ArtifactPanelData extends BasePanelData {
  type: "artifact";
  title: string;
  markdown: string;
}

/**
 * Workflow header panel — the editable card that fronts a workflow. Carries
 * its own name + description (self-contained in panel_data; synced to the
 * `workflows` table via /api/workflows). The workflow it anchors is the
 * header panel plus every `node` panel reachable from it through edges; a
 * single connector site sits at its bottom.
 */
export interface WorkflowPanelData extends BasePanelData {
  type: "workflow";
  /** DB id of the workflows row this panel fronts. */
  workflowId: string;
  name: string;
  description: string | null;
}

/**
 * A docked reference inside a node block's Read or Action field.
 * Created by dragging a KB/skill panel (or a file out of a KB panel's
 * tree) into the zone. File refs attach their parent KB to the cluster.
 */
export type NodeRef =
  | { kind: "kb"; kbId: string; name: string }
  | { kind: "file"; kbId: string; entryId: string; name: string }
  | { kind: "skill"; skillId: string; name: string };

/** Stable identity key for dedupe when docking. */
export function nodeRefKey(ref: NodeRef): string {
  switch (ref.kind) {
    case "kb":
      return `kb:${ref.kbId}`;
    case "file":
      return `file:${ref.kbId}:${ref.entryId}`;
    case "skill":
      return `skill:${ref.skillId}`;
  }
}

/**
 * NodePanelData — a workflow step. Fields are all optional-by-emptiness:
 *   - reads:   knowledge the agent should READ at this step
 *   - actions: skills the agent should APPLY at this step
 *   - userInput / agentOutput / nextInstructions: free text
 * Connector edges between nodes live in CanvasState.edges (phase 3).
 */
export interface NodePanelData extends BasePanelData {
  type: "node";
  title: string;
  description: string;
  reads: NodeRef[];
  actions: NodeRef[];
  userInput: string;
  agentOutput: string;
  nextInstructions: string;
  /** Agent authoring handle (set when a node is created/edited over MCP via
   *  set_graph). Round-tripped through panel_data so a later set_graph can
   *  match it; absent on canvas-created nodes. */
  ref?: string;
}

/** Discriminated union — add more panel types here later */
export type Panel =
  | ConnectionPanelData
  | KnowledgePanelData
  | SkillsPanelData
  | KnowledgeBasePanelData
  | SkillPanelData
  | ArtifactPanelData
  | WorkflowPanelData
  | NodePanelData;

/** Returns true if the user is allowed to close this panel. */
export function isPanelDeletable(panel: Panel): boolean {
  return panel.type !== "connection";
}

/**
 * Returns true if this panel type supports edge/corner resize. Covers the
 * individual knowledge-base / skill panels (NOT the big singleton
 * "knowledge" / "skills" library panels).
 */
export function isPanelResizable(panel: Panel): boolean {
  return (
    panel.type === "knowledge-base" ||
    panel.type === "skill" ||
    panel.type === "node"
  );
}

/** Smallest size a resizable panel can be dragged down to, by type. */
export function panelMinSize(panel: Panel): { width: number; height: number } {
  void panel;
  return DEFAULT_PANEL_MIN_SIZE;
}

export const CONNECTION_PANEL_SIZE = {
  width: 440,
  height: 560,
} as const;

export const WORKFLOW_PANEL_SIZE = {
  width: 420,
  height: 176,
} as const;

export const NODE_PANEL_SIZE = {
  // Wide + tall enough to host embedded knowledge-base views in the
  // Read zone (docked KB refs render the full KB panel body inline).
  width: 720,
  height: 960,
} as const;

export const KNOWLEDGE_PANEL_SIZE = {
  width: 1000,
  height: 700,
} as const;

export const SKILLS_PANEL_SIZE = {
  width: 1000,
  height: 700,
} as const;

export const KNOWLEDGE_BASE_PANEL_SIZE = {
  width: 560,
  height: 720,
} as const;

export const SKILL_PANEL_SIZE = {
  width: 520,
  height: 700,
} as const;

export const ARTIFACT_PANEL_SIZE = {
  width: 560,
  height: 720,
} as const;

/** Min resize size for the individual knowledge-base / skill panels. */
export const DEFAULT_PANEL_MIN_SIZE = {
  width: 360,
  height: 320,
} as const;

/**
 * Edge — a workflow connector between two panels (node blocks). Drawn
 * from the source's right port to the target's left port. Persisted in
 * the canvas_edges table (workspace-shared).
 */
export interface Edge {
  /** DB uuid (client-generated; mirrors the canvas_edges row). */
  id: string;
  fromPanelId: string;
  toPanelId: string;
}

export interface CanvasState {
  /**
   * Schema version for persistence migration.
   *  - v1: original schema (panels + camera + nextPanelId)
   *  - v2: adds `edges` (workflows are the header panel + edge-connected
   *    nodes; the old spatial `clusters` array is gone)
   */
  version: 2;
  /**
   * Camera / viewport transform.
   *  - (x, y) is the screen-space translate applied to the world div.
   *  - zoom is a scalar multiplier applied BEFORE the translate.
   * Transform equation: screen = world * zoom + { x, y }
   */
  camera: { x: number; y: number; zoom: number };
  panels: Panel[];
  /** Workflow connector edges between node / workflow-header panels. */
  edges: Edge[];
  /** Monotonic counter so each new panel gets a unique id without collisions */
  nextPanelId: number;
  /**
   * The currently-selected panel ids. Multi-select is supported via:
   *   - Shift-click on a panel (toggle membership)
   *   - Marquee drag on the canvas background (any panel intersecting
   *     the selection rect is selected)
   * Empty array means nothing is selected. The first id, if present,
   * is treated as the "primary" selection for focus affordances.
   */
  selectedPanelIds: string[];
  /**
   * Undo/redo history over the STRUCTURAL canvas state (panels + edges —
   * camera and selection are deliberately not history-worthy). Snapshots
   * are structurally shared with live state so the memory cost is one
   * array of references per entry. Session-only — NOT persisted to
   * localStorage or DB; db-sync's diff effects translate an undo/redo
   * into the matching POST/PATCH/DELETE calls automatically.
   */
  history: {
    past: CanvasSnapshot[];
    future: CanvasSnapshot[];
  };
}

/** One undo/redo history entry — the undoable subset of CanvasState. */
export interface CanvasSnapshot {
  panels: Panel[];
  edges: Edge[];
}

/** Zoom bounds. Going below 0.5 or above 4 gets confusing / unreadable. */
export const MIN_ZOOM = 0.5;
export const MAX_ZOOM = 4.0;

export const INITIAL_CANVAS_STATE: CanvasState = {
  version: 2,
  camera: { x: 0, y: 0, zoom: 1 },
  panels: [],
  edges: [],
  nextPanelId: 1,
  selectedPanelIds: [],
  history: { past: [], future: [] },
};

/**
 * Compute the axis-aligned bounding box of all panels.
 * Returns null if the array is empty.
 */
export function computePanelsBounds(panels: ReadonlyArray<BasePanelData>): {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
  centerX: number;
  centerY: number;
  width: number;
  height: number;
} | null {
  if (panels.length === 0) return null;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of panels) {
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x + p.width > maxX) maxX = p.x + p.width;
    if (p.y + p.height > maxY) maxY = p.y + p.height;
  }
  return {
    minX,
    minY,
    maxX,
    maxY,
    centerX: (minX + maxX) / 2,
    centerY: (minY + maxY) / 2,
    width: maxX - minX,
    height: maxY - minY,
  };
}

// ── Action types ────────────────────────────────────────────────────

export type CanvasAction =
  | { type: "SET_CAMERA"; camera: { x: number; y: number; zoom: number } }
  | { type: "PAN_CAMERA"; dx: number; dy: number }
  /**
   * Zoom-at-cursor. Cursor is in screen coords relative to the viewport.
   * newZoom is already clamped to [MIN_ZOOM, MAX_ZOOM] by the caller; the
   * reducer reads the current state.camera for oldZoom/oldCamera so the
   * anchoring math is applied against the freshest state (concurrent-safe).
   */
  | {
      type: "ZOOM_AT";
      cursor: { x: number; y: number };
      newZoom: number;
    }
  | { type: "MOVE_PANEL"; id: string; x: number; y: number }
  | { type: "RESIZE_PANEL"; id: string; width: number; height: number }
  | {
      /**
       * Apply absolute positions to multiple panels at once. Used when
       * dragging a multi-selection — we pre-compute each panel's new
       * position from its initial position + the cursor delta and
       * dispatch in a single batched update.
       */
      type: "MOVE_PANELS";
      moves: Array<{ id: string; x: number; y: number }>;
    }
  | { type: "CLOSE_PANEL"; id: string }
  | {
      /**
       * Replace the selection with a specific set of panel ids. Pass an
       * empty array to clear the selection. Used by:
       *  - Normal click on a panel → [panelId]
       *  - Shift-click toggle → recomputed array
       *  - Canvas marquee → live-updated as the box changes
       *  - Canvas background click → []
       */
      type: "SET_SELECTION";
      panelIds: string[];
    }
  | {
      /** Spawn a workflow header panel (already carries its DB workflowId
       *  + name/description; the create-workflow helper POSTs the row). */
      type: "CREATE_WORKFLOW";
      panel: WorkflowPanelData;
    }
  | {
      /** Patch a workflow header's name and/or description in place. */
      type: "UPDATE_WORKFLOW_INFO";
      panelId: string;
      name?: string;
      description?: string | null;
    }
  | {
      /** Spawn an empty node block at (x, y). */
      type: "CREATE_NODE_PANEL";
      id: string;
      x: number;
      y: number;
    }
  | {
      /** Patch a node's free-text fields. */
      type: "UPDATE_NODE_FIELDS";
      panelId: string;
      patch: Partial<
        Pick<
          NodePanelData,
          | "title"
          | "description"
          | "userInput"
          | "agentOutput"
          | "nextInstructions"
        >
      >;
    }
  | {
      /** Dock a KB/file/skill reference into a node's Read or Action
       *  field (dedupes by nodeRefKey). */
      type: "NODE_DOCK_REF";
      panelId: string;
      zone: "read" | "action";
      ref: NodeRef;
    }
  | {
      /** Remove a docked reference from a node field. */
      type: "NODE_UNDOCK_REF";
      panelId: string;
      zone: "read" | "action";
      refKey: string;
    }
  | {
      /** Add a connector edge (dedupes on from→to pair). */
      type: "EDGE_ADD";
      edge: Edge;
    }
  | {
      /** Remove a connector edge by id. */
      type: "EDGE_REMOVE";
      edgeId: string;
    }
  | {
      /** Spawn a knowledge panel at (x, y). */
      type: "CREATE_KNOWLEDGE_PANEL";
      id: string;
      x: number;
      y: number;
    }
  | {
      /** Spawn a skills panel at (x, y). */
      type: "CREATE_SKILLS_PANEL";
      id: string;
      x: number;
      y: number;
    }
  | {
      /** Spawn a single-KB panel at (x, y), pre-populated with the given KB. */
      type: "CREATE_KNOWLEDGE_BASE_PANEL";
      id: string;
      x: number;
      y: number;
      knowledgeBaseId: string;
      slug: string;
      name: string;
      description: string | null;
      agentWriteEnabled: boolean;
    }
  | {
      /** Spawn a single-skill panel at (x, y), pre-populated with the given skill. */
      type: "CREATE_SKILL_PANEL";
      id: string;
      x: number;
      y: number;
      skillId: string;
      slug: string;
      name: string;
      description: string;
      status: "active" | "draft";
    }
  | {
      /**
       * Spawn an artifact panel at (x, y) with the given markdown.
       * Caller picks (x, y) — typically the canvas viewport center via
       * computeNewPanelPosition.
       */
      type: "CREATE_ARTIFACT_PANEL";
      id: string;
      x: number;
      y: number;
      title: string;
      markdown: string;
    }
  | {
      /** In-place edit of an artifact panel's markdown body. */
      type: "UPDATE_ARTIFACT_MARKDOWN";
      panelId: string;
      markdown: string;
    }
  | {
      /** Rename an artifact panel. */
      type: "UPDATE_ARTIFACT_TITLE";
      panelId: string;
      title: string;
    }
  | {
      /** Apply a panel row received over realtime (another writer — e.g. an
       *  MCP agent). Adds if new; for an existing panel patches position /
       *  size / panel_data, but NOT one the user has selected (likely mid-
       *  drag) so a debounced echo can't snap it back. */
      type: "APPLY_REMOTE_PANEL_UPSERT";
      panel: Panel;
    }
  | { type: "APPLY_REMOTE_PANEL_REMOVE"; panelId: string }
  | { type: "APPLY_REMOTE_EDGE_UPSERT"; edge: Edge }
  | { type: "APPLY_REMOTE_EDGE_REMOVE"; edgeId: string }
  | { type: "HYDRATE"; state: CanvasState }
  | {
      /** Delete all selected panels (that are deletable). */
      type: "DELETE_SELECTED_PANELS";
    }
  | {
      /**
       * Push a history entry for the CURRENT state. Dispatched at the
       * start of coalesced gestures (panel drag / resize) so the whole
       * gesture undoes as one step — discrete actions push their own
       * entries via the reducer's history wrapper.
       */
      type: "HISTORY_CHECKPOINT";
    }
  | {
      /** Step back one history entry (panels + edges). */
      type: "UNDO";
    }
  | {
      /** Step forward one history entry (panels + edges). */
      type: "REDO";
    };

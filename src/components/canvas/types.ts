/**
 * Canvas + panel type definitions.
 *
 * The canvas is an infinite world. Panels live at world coordinates;
 * the camera offset translates world → screen for rendering.
 */

import type {
  ChatMessage,
  ProgressEvent,
} from "@/components/ingest/chat-message";

export interface BasePanelData {
  id: string;
  /** World coordinates (top-left of the panel box) */
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface ChatPanelData extends BasePanelData {
  type: "chat";
  title: string;
  messages: ChatMessage[];
  isProcessing: boolean;
  /** Set while an ingestion is in progress; cleared on terminal event */
  activeEntryId: string | null;
  /**
   * Seed message typed in the FixedInputBar when the panel was spawned.
   * The chat panel consumes this on mount, clears it, and fires a normal
   * chat send. Makes the "type in the bottom bar → new chat panel with
   * that message as the first send" flow work without crossing component
   * boundaries.
   */
  pendingInput?: string;
  /** Supabase row ID once the conversation has been persisted. */
  conversationId?: string;
  /** When true, conversation persists indefinitely (no auto-delete). */
  pinned?: boolean;
  /** ISO timestamp when the conversation will auto-delete (if not pinned). */
  expiresAt?: string;
}

/**
 * ConnectionPanelData — singleton panel that holds the user's API key
 * and shows the MCP / cURL connection details. Auto-spawned on first load,
 * cannot be deleted, only one of these exists at a time.
 */
export interface ConnectionPanelData extends BasePanelData {
  type: "connection";
  /** User's SIE API key (sk-sie-...) — null until they paste one */
  apiKey: string | null;
}

/**
 * EntryPanelData — rich viewer for a generated entry. Auto-spawned to the
 * right of a chat panel when its ingestion completes. Holds a snapshot of
 * the entry's data (thumbnail, metadata, tags, artifacts) so the panel
 * works offline and doesn't need a network round-trip on canvas reload.
 */
export interface EntryPanelData extends BasePanelData {
  type: "entry";
  /** Supabase entry id */
  entryId: string;
  title: string;
  summary: string | null;
  sourceUrl: string;
  sourcePlatform: string | null;
  sourceAuthor: string | null;
  thumbnailUrl: string | null;
  useCase: string | null;
  complexity: string | null;
  /** Tags as typed key/value pairs (same shape the /api/entries/[id] returns) */
  tags: Array<{ type: string; value: string }>;
  /** Artifacts snapshotted at spawn time */
  readme: string;
  agentsMd: string;
  manifest: Record<string, unknown>;
  /** Optional back-reference to the chat panel that spawned this entry */
  sourceChatPanelId?: string;
  createdAt: string;
}

export interface BrowsePanelData extends BasePanelData {
  type: "browse";
}

/**
 * ClusterBrainPanelData — the persistent "brain" of a cluster. Auto-spawned
 * when a cluster is created. Contains synthesized instructions (merged from
 * entry agents.mds) and user memories (corrections/overrides that persist
 * across sessions). The AI reads this instead of raw entry agents.mds.
 */
export interface ClusterBrainPanelData extends BasePanelData {
  type: "cluster-brain";
  /** Which cluster this brain belongs to */
  clusterId: string;
  /** Display name (mirrors cluster name) */
  clusterName: string;
  /** Synthesized agents.md — merged from all entry agents.mds in the cluster */
  instructions: string;
  /** User corrections/overrides that supplement or override instructions */
  memories: string[];
  /** Generation status */
  status: "generating" | "ready" | "error";
  /** Error message if synthesis failed */
  errorMessage: string | null;
}

/** Discriminated union — add more panel types here later */
export type Panel =
  | ChatPanelData
  | ConnectionPanelData
  | EntryPanelData
  | BrowsePanelData
  | ClusterBrainPanelData;

/** Returns true if the user is allowed to close this panel. */
export function isPanelDeletable(panel: Panel): boolean {
  return panel.type !== "connection";
}

/** Returns true if this panel type can participate in clusters. */
export function isPanelClusterable(panel: Panel): boolean {
  return panel.type !== "connection" && panel.type !== "browse";
}

/**
 * Cluster — a persistent grouping of panels with a visible outline and
 * header tab. Creating a cluster auto-reorganizes the selected panels into
 * a tight grid and draws a rectilinear union outline around them.
 *
 * Invariants:
 *  - `panelIds.length >= 2` — single-panel clusters are auto-dissolved.
 *  - Each panel id appears in AT MOST one cluster. Creating a cluster that
 *    includes an already-clustered panel will remove it from its old
 *    cluster first.
 *  - Panel ids in `panelIds` must refer to real panels in `state.panels`.
 *    Closing a panel (CLOSE_PANEL) strips it from every cluster.
 */
export interface Cluster {
  id: string;
  name: string;
  panelIds: string[];
  createdAt: string;
  /** DB row id — populated after syncing to /api/clusters. */
  dbId?: string;
  /** URL-safe slug — populated after syncing to /api/clusters. */
  slug?: string;
}

export const CONNECTION_PANEL_SIZE = {
  width: 440,
  height: 560,
} as const;

export const ENTRY_PANEL_SIZE = {
  width: 520,
  height: 700,
} as const;

export const BROWSE_PANEL_SIZE = {
  width: 1200,
  height: 700,
} as const;

export const CLUSTER_BRAIN_PANEL_SIZE = {
  width: 520,
  height: 700,
} as const;

export const BROWSE_PANEL_MIN_SIZE = {
  width: 700,
  height: 400,
} as const;

/** Minimum members a cluster must have to exist. Below this → auto-dissolve. */
export const MIN_CLUSTER_SIZE = 2;

/** World-space padding between cluster members and the outline. */
export const CLUSTER_PADDING = 24;

/** Corner radius (world-space px) for the rounded rectilinear outline. */
export const CLUSTER_CORNER_RADIUS = 12;

/**
 * Grace distance (world-space px) used to re-compute cluster membership
 * while a panel is being dragged. A panel belongs to a cluster iff its
 * bounding box is within this distance of at least one other member.
 *
 * Bigger = more room to jiggle a member around without accidentally
 * declustering. When a panel drags past this threshold away from every
 * other cluster member, it auto-leaves. When a non-clustered panel
 * drags within this threshold of a cluster, it auto-joins.
 */
export const CLUSTER_MEMBERSHIP_DISTANCE = 140;

export interface CanvasState {
  /**
   * Schema version for persistence migration.
   *  - v1: original schema (panels + camera + nextPanelId)
   *  - v2: adds `clusters: Cluster[]`
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
  /** Persistent panel groupings; see Cluster interface for invariants. */
  clusters: Cluster[];
  /** Monotonic counter so each new panel gets a unique id without collisions */
  nextPanelId: number;
  /** Monotonic counter for cluster ids (separate namespace from panels). */
  nextClusterId: number;
  /**
   * The currently-selected panel ids. Multi-select is supported via:
   *   - Shift-click on a panel (toggle membership)
   *   - Marquee drag on the canvas background (any panel intersecting
   *     the selection rect is selected)
   * Empty array means nothing is selected. The first id, if present,
   * is treated as the "primary" selection for focus affordances.
   */
  selectedPanelIds: string[];
}

/** Zoom bounds. Going below 0.25 or above 4 gets confusing / unreadable. */
export const MIN_ZOOM = 0.25;
export const MAX_ZOOM = 4.0;

export const INITIAL_CANVAS_STATE: CanvasState = {
  version: 2,
  camera: { x: 0, y: 0, zoom: 1 },
  panels: [],
  clusters: [],
  nextPanelId: 1,
  nextClusterId: 1,
  selectedPanelIds: [],
};

export const DEFAULT_PANEL_SIZE = {
  width: 480,
  height: 600,
} as const;

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
  | {
      type: "CREATE_CHAT_PANEL";
      id: string;
      x: number;
      y: number;
      title: string;
      /** Optional first message the panel will send as soon as it mounts. */
      pendingInput?: string;
    }
  | {
      /**
       * Clear a chat panel's `pendingInput`. Dispatched by the chat
       * panel after it consumes the seed input.
       */
      type: "CLEAR_PENDING_INPUT";
      panelId: string;
    }
  | { type: "CLOSE_PANEL"; id: string }
  | { type: "UPDATE_CHAT_TITLE"; panelId: string; title: string }
  | { type: "SET_CHAT_PINNED"; panelId: string; pinned: boolean }
  | {
      /** Replace a chat panel's messages wholesale with server-loaded data. */
      type: "HYDRATE_CHAT_MESSAGES";
      panelId: string;
      messages: ChatMessage[];
      conversationId: string;
    }
  | { type: "APPEND_MESSAGE"; panelId: string; message: ChatMessage }
  | {
      /**
       * Update the content of the LAST `streaming`-type message in a
       * chat panel. If the last message isn't a streaming message, a
       * new one is appended. Used by the real-chat SSE loop to stream
       * tokens into a single bubble without bloating the message log.
       */
      type: "UPDATE_STREAMING_MESSAGE";
      panelId: string;
      content: string;
    }
  | {
      /**
       * Convert the LAST `streaming` message in a chat panel to a
       * finalised `text` message with the given content. Used at the
       * end of an AI response to commit the streamed text. If the last
       * message isn't a streaming message, this is a no-op.
       */
      type: "FINALISE_STREAMING_MESSAGE";
      panelId: string;
      content: string;
    }
  | {
      type: "UPDATE_PROGRESS";
      panelId: string;
      entryId: string;
      event: import("@/components/ingest/chat-message").ProgressEvent;
    }
  | {
      type: "SET_PROCESSING";
      panelId: string;
      isProcessing: boolean;
      activeEntryId: string | null;
    }
  | {
      type: "ADD_ARTIFACTS";
      panelId: string;
      entryId: string;
      title: string;
      readme: string;
      agentsMd: string;
      manifest: Record<string, unknown>;
    }
  | {
      type: "SET_CONNECTION_API_KEY";
      panelId: string;
      apiKey: string | null;
    }
  | {
      /**
       * Replace the selection with a specific set of panel ids. Pass an
       * empty array to clear the selection. Used by:
       *  - Normal click on a panel → [panelId]
       *  - Shift-click toggle → recomputed array
       *  - Canvas marquee → live-updated as the box changes
       *  - Chat textarea focus → [panelId]
       *  - Canvas background click → []
       */
      type: "SET_SELECTION";
      panelIds: string[];
    }
  | {
      /**
       * Auto-spawn a new EntryPanel next to the chat panel that just finished
       * ingesting. The reducer looks up `sourcePanelId` to position the new
       * panel to its right; falls back to the camera viewport center if the
       * source chat panel is gone.
       *
       * If `position` is provided, it overrides the default "right-of-source"
       * logic — used by the IngestionPanel replacement flow so the new entry
       * takes over the ingestion panel's exact slot.
       *
       * If the source panel belongs to a cluster, the new entry is auto-
       * joined to that cluster so chat-generated entries stay grouped.
       */
      type: "SPAWN_ENTRY_PANEL";
      sourcePanelId: string;
      entryId: string;
      title: string;
      summary: string | null;
      sourceUrl: string;
      sourcePlatform: string | null;
      sourceAuthor: string | null;
      thumbnailUrl: string | null;
      useCase: string | null;
      complexity: string | null;
      tags: Array<{ type: string; value: string }>;
      readme: string;
      agentsMd: string;
      manifest: Record<string, unknown>;
      position?: { x: number; y: number };
    }
  | {
      /**
       * Create a new cluster and atomically apply a set of panel moves.
       * The two happen in one reducer step so the outline never flashes in
       * the "before" layout.
       *
       * The reducer also:
       *  - Strips the clustered panel ids from any other clusters (one-per-panel)
       *  - Drops any cluster that falls below MIN_CLUSTER_SIZE as a result
       *  - Bumps nextClusterId
       */
      type: "CREATE_CLUSTER";
      cluster: Cluster;
      moves: Array<{ id: string; x: number; y: number }>;
    }
  | { type: "DELETE_CLUSTER"; clusterId: string }
  | { type: "UPDATE_CLUSTER_NAME"; clusterId: string; name: string }
  | {
      /**
       * Append a panel to an existing cluster. Preserves the cluster's
       * name/createdAt — this is a membership update, NOT a re-cluster.
       * Strips the panel from any other cluster first to enforce the
       * one-cluster-per-panel invariant.
       */
      type: "ADD_PANEL_TO_CLUSTER";
      panelId: string;
      clusterId: string;
    }
  | {
      /**
       * Remove a panel from whatever cluster it currently belongs to.
       * If that drops the cluster below MIN_CLUSTER_SIZE it's
       * auto-dissolved.
       */
      type: "REMOVE_PANEL_FROM_CLUSTER";
      panelId: string;
    }
  | {
      /** Spawn an empty browse panel at (x, y). */
      type: "CREATE_BROWSE_PANEL";
      id: string;
      x: number;
      y: number;
    }
  | {
      /** Attach DB-generated id and slug to a cluster after API sync. */
      type: "UPDATE_CLUSTER_DB_INFO";
      clusterId: string;
      dbId: string;
      slug: string;
    }
  | {
      /** Spawn a cluster brain panel with initial "generating" status. */
      type: "CREATE_CLUSTER_BRAIN_PANEL";
      id: string;
      clusterId: string;
      clusterName: string;
      x: number;
      y: number;
    }
  | {
      /** Set synthesized instructions and mark the brain as ready. */
      type: "UPDATE_CLUSTER_BRAIN_INSTRUCTIONS";
      panelId: string;
      instructions: string;
    }
  | {
      /** Manually edit the instructions text. */
      type: "UPDATE_CLUSTER_BRAIN_INSTRUCTIONS_TEXT";
      panelId: string;
      instructions: string;
    }
  | {
      /** Append a memory to the cluster brain. */
      type: "ADD_CLUSTER_BRAIN_MEMORY";
      panelId: string;
      memory: string;
    }
  | {
      /** Remove a memory by index. */
      type: "REMOVE_CLUSTER_BRAIN_MEMORY";
      panelId: string;
      index: number;
    }
  | {
      /** Mark the brain as errored. */
      type: "SET_CLUSTER_BRAIN_ERROR";
      panelId: string;
      errorMessage: string;
    }
  | { type: "HYDRATE"; state: CanvasState };

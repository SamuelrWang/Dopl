"use client";

import {
  useEffect,
  useMemo,
  useReducer,
  useRef,
  type ReactNode,
} from "react";
import type { CanvasState, Panel } from "../types";
import {
  CanvasContext,
  PanelsContext,
  CanvasStateRefContext,
  CapabilitiesContext,
  DEFAULT_CAPABILITIES,
  useCanvas,
  type CanvasCapabilities,
} from "./context";
import { reducer } from "./reducer";
import { useCanvasDbSync } from "../use-canvas-db-sync";
import { useEntriesRealtime } from "../use-entries-realtime";
import { useClustersRealtime } from "../use-clusters-realtime";
import {
  useConversationSync,
  ChatConversationsProvider,
  type ServerConversation,
} from "../use-conversation-sync";
import { CanvasScopeContext } from "./context";
import { CANVAS_STORAGE_KEY_PREFIX, CANVAS_ACTIVE_USER_KEY } from "@/config";

const SAVE_DEBOUNCE_MS = 500;

/** Build the user-scoped localStorage key for canvas state. */
function getStorageKey(userId?: string): string {
  const uid = userId || (typeof window !== "undefined" ? localStorage.getItem(CANVAS_ACTIVE_USER_KEY) : null);
  return uid ? `${CANVAS_STORAGE_KEY_PREFIX}:${uid}` : CANVAS_STORAGE_KEY_PREFIX;
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
   * Active canvas (workspace) scope. Required for "user" sync mode —
   * threads through every fetch as `X-Canvas-Id` and into the
   * realtime subscription filters. Omit for shared / read-only views.
   */
  canvasId?: string;
  canvasSlug?: string;
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
  canvasId,
  canvasSlug,
  initialState,
  initialConversations,
  syncStrategy = "user",
  capabilities,
  onPanelsMove,
}: CanvasProviderProps) {
  const scope = useMemo(
    () => (canvasId && canvasSlug ? { canvasId, canvasSlug } : null),
    [canvasId, canvasSlug]
  );
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
    <CanvasScopeContext.Provider value={scope}>
      <CanvasContext.Provider value={{ state, dispatch }}>
        <PanelsContext.Provider value={panelsCtx}>
          <CanvasStateRefContext.Provider value={stateRef}>
            <CapabilitiesContext.Provider value={effectiveCapabilities}>
              <ChatConversationsProvider initialConversations={initialConversations}>
                {syncStrategy === "user" && <CanvasDbSyncBridge />}
                {syncStrategy === "user" && <ConversationSyncBridge />}
                {syncStrategy === "user" && <EntriesRealtimeBridge />}
                {syncStrategy === "user" && <ClustersRealtimeBridge />}
                {syncStrategy === "user" && <AutoFocusNewPanelBridge />}
                {syncStrategy === "shared" && (
                  <SharedPanelMoveBridge onPanelsMove={onPanelsMove} />
                )}
                {children}
              </ChatConversationsProvider>
            </CapabilitiesContext.Provider>
          </CanvasStateRefContext.Provider>
        </PanelsContext.Provider>
      </CanvasContext.Provider>
    </CanvasScopeContext.Provider>
  );
}

/**
 * Pan the camera to center any newly-spawned panel in the viewport.
 * Triggers only when exactly one panel is added since the previous render,
 * so bulk hydration (initial load, undo-restore) doesn't hijack the view.
 * Keeps the current zoom — only the center point changes.
 */
function useAutoFocusNewPanel() {
  const { state, dispatch } = useCanvas();
  const knownIdsRef = useRef<Set<string> | null>(null);
  const stateRef = useRef(state);
  stateRef.current = state;

  useEffect(() => {
    const panels = state.panels;

    // First run — seed baseline without focusing on anything.
    if (knownIdsRef.current === null) {
      knownIdsRef.current = new Set(panels.map((p) => p.id));
      return;
    }

    const known = knownIdsRef.current;
    const newPanels: Panel[] = [];
    for (const p of panels) {
      if (!known.has(p.id)) newPanels.push(p);
    }

    // Refresh the tracked set (add new, drop removed).
    const liveIds = new Set(panels.map((p) => p.id));
    for (const id of known) {
      if (!liveIds.has(id)) known.delete(id);
    }
    for (const p of newPanels) known.add(p.id);

    // Only focus on single-panel additions — the typical user-driven spawn.
    // Bulk additions (hydrate, restore) would be disorienting to pan through.
    if (newPanels.length !== 1) return;
    if (typeof window === "undefined") return;

    const target = newPanels[0];
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const zoom = stateRef.current.camera.zoom;
    dispatch({
      type: "SET_CAMERA",
      camera: {
        x: -(target.x + target.width / 2) * zoom + vw / 2,
        y: -(target.y + target.height / 2) * zoom + vh / 2,
        zoom,
      },
    });
  }, [state.panels, dispatch]);
}

function AutoFocusNewPanelBridge() {
  useAutoFocusNewPanel();
  return null;
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

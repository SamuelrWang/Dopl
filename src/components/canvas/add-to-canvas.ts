/**
 * add-to-canvas.ts — standalone utility for injecting an EntryPanel into the
 * canvas's persisted state from *outside* the CanvasProvider.
 *
 * Used by the browse page's EntryCard "add to canvas" button. Because the
 * browse page isn't wrapped in <CanvasProvider>, we can't use useCanvas()
 * here — so we read/write the same localStorage key the provider hydrates
 * from. On the user's next visit to /canvas, the panel will be there.
 *
 * Two functions:
 *  - fetchFullEntry(entryId): loads the full entry from /api/entries/{id},
 *    which includes readme / agents_md / manifest / tags (the browse list
 *    endpoint returns only lightweight fields).
 *  - addEntryPanelToCanvas(entry): constructs an EntryPanelData and appends
 *    it to the canvas state in localStorage.
 */

import type { CanvasState, EntryPanelData } from "./types";
import {
  ENTRY_PANEL_SIZE,
  INITIAL_CANVAS_STATE,
} from "./types";

const ACTIVE_USER_KEY = "sie:canvas:active-user";
const STORAGE_KEY_PREFIX = "sie:canvas:state";

/** Get the user-scoped storage key, matching canvas-store.tsx logic. */
function getStorageKey(): string {
  if (typeof window === "undefined") return STORAGE_KEY_PREFIX;
  const uid = localStorage.getItem(ACTIVE_USER_KEY);
  return uid ? `${STORAGE_KEY_PREFIX}:${uid}` : STORAGE_KEY_PREFIX;
}

// ── Types ──────────────────────────────────────────────────────────

/** Raw shape returned by GET /api/entries/{id}. Mirrors what we use in use-panel-ingestion.ts. */
export interface FullEntryResponse {
  id: string;
  title?: string | null;
  summary?: string | null;
  source_url?: string;
  source_platform?: string | null;
  source_author?: string | null;
  thumbnail_url?: string | null;
  use_case?: string | null;
  complexity?: string | null;
  readme?: string | null;
  agents_md?: string | null;
  manifest?: Record<string, unknown> | null;
  tags?: Array<{ tag_type: string; tag_value: string }>;
}

// ── Helpers (mirrored from canvas-store.tsx) ───────────────────────

/** Pre-zoom canvases persisted `camera: { x, y }` without zoom. Inject zoom=1. */
function migratePreZoomCamera(state: CanvasState): CanvasState {
  if (typeof state.camera.zoom === "number") return state;
  return {
    ...state,
    camera: { ...state.camera, zoom: 1 },
  };
}

/**
 * Schema v1 → v2 migration: inject an empty clusters array + nextClusterId.
 * Mirrors `migrateAddClusters` in canvas-store.tsx. We duplicate rather than
 * import to keep this utility dependency-free from the provider.
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
 * Camera-viewport-center spawn. Duplicated from canvas-store.tsx so this file
 * stays a standalone utility with no circular imports into the provider.
 */
function computeSpawnPosition(
  state: CanvasState,
  viewportWidth: number,
  viewportHeight: number,
  panelWidth: number,
  panelHeight: number
): { x: number; y: number } {
  const { x: camX, y: camY, zoom } = state.camera;
  const worldX = (viewportWidth / 2 - camX) / zoom;
  const worldY = (viewportHeight / 2 - camY) / zoom;
  const spawnOffset = (state.nextPanelId % 8) * 24;
  return {
    x: Math.round(worldX - panelWidth / 2 + spawnOffset),
    y: Math.round(worldY - panelHeight / 2 + spawnOffset),
  };
}

/** Read + migrate the saved canvas state. Returns a fresh initial state if nothing exists. */
function loadCanvasState(): CanvasState {
  if (typeof window === "undefined") return INITIAL_CANVAS_STATE;
  try {
    const raw = localStorage.getItem(getStorageKey());
    if (!raw) return INITIAL_CANVAS_STATE;
    // Parse as unknown first — the TS CanvasState type is narrow
    // (version: 2) but localStorage can still hold a pre-migration v1 blob.
    // We Omit the version field from CanvasState so the unknown parse
    // doesn't collapse back to the literal 2.
    const parsed = JSON.parse(raw) as unknown as Omit<CanvasState, "version"> & {
      version: number;
    };
    if (parsed.version !== 1 && parsed.version !== 2) {
      return INITIAL_CANVAS_STATE;
    }
    return migrateAddClusters(migratePreZoomCamera(parsed as CanvasState));
  } catch {
    return INITIAL_CANVAS_STATE;
  }
}

function saveCanvasState(state: CanvasState): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(getStorageKey(), JSON.stringify(state));
  } catch {
    // Storage quota exceeded or unavailable — swallow
  }
}

// ── Public API ─────────────────────────────────────────────────────

/**
 * Fetch the full entry (including readme / agents_md / manifest / tags) from
 * the server. The browse list endpoint returns a lightweight subset, so we
 * need this round-trip to produce a complete EntryPanelData.
 */
export async function fetchFullEntry(
  entryId: string
): Promise<FullEntryResponse | null> {
  try {
    const res = await fetch(`/api/entries/${entryId}`);
    if (!res.ok) return null;
    return (await res.json()) as FullEntryResponse;
  } catch {
    return null;
  }
}

/**
 * Inject an EntryPanel into the persisted canvas state. Returns true on
 * success, false on failure. Idempotent-ish: does NOT dedupe by entryId
 * (user may want multiple copies of the same entry).
 *
 * Since this runs outside the React provider, changes won't be visible until
 * the /canvas page hydrates from localStorage on its next mount.
 */
export function addEntryPanelToCanvas(entry: FullEntryResponse): boolean {
  if (typeof window === "undefined") return false;

  const state = loadCanvasState();

  const pos = computeSpawnPosition(
    state,
    window.innerWidth,
    window.innerHeight,
    ENTRY_PANEL_SIZE.width,
    ENTRY_PANEL_SIZE.height
  );

  const newPanel: EntryPanelData = {
    id: `entry-${state.nextPanelId}`,
    type: "entry",
    x: pos.x,
    y: pos.y,
    width: ENTRY_PANEL_SIZE.width,
    height: ENTRY_PANEL_SIZE.height,
    entryId: entry.id,
    title: entry.title || "Untitled Setup",
    summary: entry.summary ?? null,
    sourceUrl: entry.source_url ?? "",
    sourcePlatform: entry.source_platform ?? null,
    sourceAuthor: entry.source_author ?? null,
    thumbnailUrl: entry.thumbnail_url ?? null,
    useCase: entry.use_case ?? null,
    complexity: entry.complexity ?? null,
    tags: (entry.tags ?? []).map((t) => ({
      type: t.tag_type,
      value: t.tag_value,
    })),
    readme: entry.readme || "",
    agentsMd: entry.agents_md || "",
    manifest: entry.manifest || {},
    createdAt: new Date().toISOString(),
  };

  const nextState: CanvasState = {
    ...state,
    panels: [...state.panels, newPanel],
    nextPanelId: state.nextPanelId + 1,
  };

  saveCanvasState(nextState);
  return true;
}

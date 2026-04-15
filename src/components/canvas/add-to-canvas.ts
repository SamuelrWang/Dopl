/**
 * add-to-canvas.ts — standalone utility for injecting an EntryPanel into the
 * canvas from *outside* the CanvasProvider (e.g. browse page).
 *
 * Writes to both DB (durable) and localStorage cache (instant). The canvas
 * page will pick up the panel from DB on next load via HYDRATE_FROM_DB.
 */

import type { CanvasState, EntryPanelData } from "./types";
import { ENTRY_PANEL_SIZE, INITIAL_CANVAS_STATE } from "./types";
import { CANVAS_ACTIVE_USER_KEY, CANVAS_STORAGE_KEY_PREFIX } from "@/lib/config";

function getStorageKey(): string {
  if (typeof window === "undefined") return CANVAS_STORAGE_KEY_PREFIX;
  const uid = localStorage.getItem(CANVAS_ACTIVE_USER_KEY);
  return uid ? `${CANVAS_STORAGE_KEY_PREFIX}:${uid}` : CANVAS_STORAGE_KEY_PREFIX;
}

// ── Types ──────────────────────────────────────────────────────────

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
  content_type?: string | null;
  readme?: string | null;
  agents_md?: string | null;
  manifest?: Record<string, unknown> | null;
  tags?: Array<{ tag_type: string; tag_value: string }>;
}

// ── Helpers ────────────────────────────────────────────────────────

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

function loadCanvasState(): CanvasState {
  if (typeof window === "undefined") return INITIAL_CANVAS_STATE;
  try {
    const raw = localStorage.getItem(getStorageKey());
    if (!raw) return INITIAL_CANVAS_STATE;
    const parsed = JSON.parse(raw) as CanvasState;
    if (!parsed.camera || !Array.isArray(parsed.panels)) return INITIAL_CANVAS_STATE;
    if (typeof parsed.camera.zoom !== "number") {
      parsed.camera = { ...parsed.camera, zoom: 1 };
    }
    return parsed;
  } catch {
    return INITIAL_CANVAS_STATE;
  }
}

function saveCanvasState(state: CanvasState): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(getStorageKey(), JSON.stringify(state));
  } catch {
    // Storage quota exceeded
  }
}

// ── Public API ─────────────────────────────────────────────────────

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
 * Inject an EntryPanel into the canvas. Writes to both DB (durable) and
 * localStorage (cache). Returns true on success.
 */
export async function addEntryPanelToCanvas(
  entry: FullEntryResponse
): Promise<boolean> {
  if (typeof window === "undefined") return false;

  const state = loadCanvasState();
  const pos = computeSpawnPosition(
    state,
    window.innerWidth,
    window.innerHeight,
    ENTRY_PANEL_SIZE.width,
    ENTRY_PANEL_SIZE.height
  );

  const panelId = `entry-${state.nextPanelId}`;
  const tags = (entry.tags ?? []).map((t) => ({
    type: t.tag_type,
    value: t.tag_value,
  }));

  // 1. Write to DB (durable path)
  try {
    await fetch("/api/canvas/panels", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        panel_id: panelId,
        panel_type: "entry",
        entry_id: entry.id,
        x: pos.x,
        y: pos.y,
        width: ENTRY_PANEL_SIZE.width,
        height: ENTRY_PANEL_SIZE.height,
        title: entry.title || "Untitled Setup",
        summary: entry.summary || null,
        source_url: entry.source_url || "",
        panel_data: {
          sourcePlatform: entry.source_platform || null,
          sourceAuthor: entry.source_author || null,
          thumbnailUrl: entry.thumbnail_url || null,
          useCase: entry.use_case || null,
          complexity: entry.complexity || null,
          tags,
          readme: entry.readme || "",
          agentsMd: entry.agents_md || "",
          manifest: entry.manifest || {},
          createdAt: new Date().toISOString(),
        },
      }),
    });
  } catch {
    // Fall through to localStorage-only
  }

  // 2. Bump counter in DB
  fetch("/api/canvas/state", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ next_panel_id: state.nextPanelId + 1 }),
  }).catch((err) => console.error("[add-to-canvas] counter sync failed:", err));

  // 3. Also update localStorage cache (visible on next /canvas mount)
  const newPanel: EntryPanelData = {
    id: panelId,
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
    contentType: entry.content_type ?? null,
    tags,
    readme: entry.readme || "",
    agentsMd: entry.agents_md || "",
    manifest: entry.manifest || {},
    createdAt: new Date().toISOString(),
  };

  saveCanvasState({
    ...state,
    panels: [...state.panels, newPanel],
    nextPanelId: state.nextPanelId + 1,
  });

  return true;
}

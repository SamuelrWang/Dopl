"use client";

/**
 * Canvas store — public barrel.
 *
 * Split from the original 1391-line monolith in P5a into topic-focused
 * sub-modules under `./canvas-store/`:
 *
 *   context.tsx    — React contexts + hook gates (useCanvas,
 *                    usePanelsContext, useCanvasStateRef, useCapabilities).
 *   reducer.ts     — the `reducer` function (the entire canvas state
 *                    machine — single switch statement, grandfathered
 *                    past the 500-line cap per ENGINEERING.md §2
 *                    exception for cohesive reducer state machines).
 *   layout.ts      — computeNewPanelPosition, findNonOverlappingPosition,
 *                    nextPanelIdString (pure geometry helpers).
 *   provider.tsx   — CanvasProvider + all the sync-bridge components
 *                    (DB / conversations / realtime / auto-focus /
 *                    shared-panel-move).
 *
 * Importers keep using `@/features/canvas/canvas-store` — this barrel
 * preserves every public symbol that existed before the split. Prefer
 * the direct sub-module paths for new code.
 */

// Hooks + context types
export {
  useCanvas,
  usePanelsContext,
  useCanvasStateRef,
  useCapabilities,
  type CanvasCapabilities,
} from "./canvas-store/context";

// Provider + sync-strategy types
export { CanvasProvider, type CanvasSyncStrategy } from "./canvas-store/provider";

// Layout helpers (used by add-to-canvas + panel spawn callers)
export {
  computeNewPanelPosition,
  findNonOverlappingPosition,
  nextPanelIdString,
} from "./canvas-store/layout";

// Re-export domain types
export type {
  Panel,
  ChatPanelData,
  EntryPanelData,
  CanvasState,
  CanvasAction,
} from "./types";

export type {
  ChatMessage,
  ProgressEvent,
} from "@/components/ingest/chat-message";

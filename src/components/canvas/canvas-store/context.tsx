"use client";

import { createContext, useContext, type Dispatch, type MutableRefObject } from "react";
import type { CanvasState, CanvasAction, Panel, Cluster } from "../types";

// ── Context value types ───────────────────────────────────────────

interface CanvasContextValue {
  state: CanvasState;
  dispatch: Dispatch<CanvasAction>;
}

export const CanvasContext = createContext<CanvasContextValue | null>(null);

/**
 * Separate context carrying only panels + clusters + dispatch.
 * Components that don't need camera can subscribe to this instead of
 * CanvasContext, avoiding re-renders on camera/zoom changes.
 */
interface PanelsContextValue {
  panels: Panel[];
  clusters: Cluster[];
  dispatch: Dispatch<CanvasAction>;
}
export const PanelsContext = createContext<PanelsContextValue | null>(null);

/**
 * Ref-based context for non-rendering reads of canvas state.
 * The ref object identity never changes, so consumers subscribing to this
 * context never re-render from it.
 */
export const CanvasStateRefContext = createContext<MutableRefObject<CanvasState> | null>(null);

/**
 * Capabilities — what the current viewer is allowed to do on this canvas.
 * The `/canvas` page always runs with everything enabled (default).
 * Read-only / shared-cluster views turn individual flags off.
 */
export interface CanvasCapabilities {
  canMove: boolean;
  canDelete: boolean;
  canAdd: boolean;
}

export const DEFAULT_CAPABILITIES: CanvasCapabilities = {
  canMove: true,
  canDelete: true,
  canAdd: true,
};

export const CapabilitiesContext = createContext<CanvasCapabilities>(DEFAULT_CAPABILITIES);

// ── Hooks ────────────────────────────────────────────────────────

export function useCapabilities(): CanvasCapabilities {
  return useContext(CapabilitiesContext);
}

export function useCanvas(): CanvasContextValue {
  const ctx = useContext(CanvasContext);
  if (!ctx) throw new Error("useCanvas must be used inside <CanvasProvider>");
  return ctx;
}

/**
 * Subscribe to panels + clusters without re-rendering on camera changes.
 * Use this in fixed UI (e.g. FixedChatPanel) that doesn't need camera.
 */
export function usePanelsContext(): PanelsContextValue {
  const ctx = useContext(PanelsContext);
  if (!ctx) throw new Error("usePanelsContext must be used inside <CanvasProvider>");
  return ctx;
}

/**
 * Returns a stable ref that always points to the latest CanvasState.
 * Reading `.current` in event handlers gives the freshest state without
 * causing the consuming component to re-render on state changes.
 */
export function useCanvasStateRef(): MutableRefObject<CanvasState> {
  const ref = useContext(CanvasStateRefContext);
  if (!ref) throw new Error("useCanvasStateRef must be used inside <CanvasProvider>");
  return ref;
}

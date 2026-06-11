/**
 * defaults.ts — Canvas state invariants that must hold regardless of how
 * state enters the reducer (via client-side hydration OR server-side
 * pre-render).
 *
 * Extracted from canvas-store.tsx so both the client reducer and the
 * server-side initial-state loader enforce the same rules. Pure
 * functions, no React, no DB.
 *
 *   - `dedupSingletonPanels`: collapse multiple connection panels to one
 *     (historical bug self-heal).
 *   - `ensureDefaultPanels`: inject the connection default if missing.
 */

import type { CanvasState, Panel } from "@/features/canvas/types";
import { CONNECTION_PANEL_SIZE } from "@/features/canvas/types";

export function dedupSingletonPanels(state: CanvasState): CanvasState {
  const SINGLETON_TYPES = new Set(["connection"]);
  const seen = new Set<string>();
  const seenIds = new Set<string>();
  const dropped = new Set<string>();
  const kept: Panel[] = [];

  let removedDuplicateIds = false;

  for (const p of state.panels) {
    // Duplicate panel IDs (any type) — keep the first occurrence. A
    // stale counter or replayed action can persist a duplicate into
    // localStorage / in-memory state; the DB's unique constraint can't
    // hold one, so the first is always the row that actually exists.
    // NOT added to `dropped`: the surviving copy shares the id and must
    // keep its selection.
    if (seenIds.has(p.id)) {
      removedDuplicateIds = true;
      continue;
    }
    seenIds.add(p.id);
    if (SINGLETON_TYPES.has(p.type)) {
      if (seen.has(p.type)) {
        dropped.add(p.id);
        continue;
      }
      seen.add(p.type);
    }
    kept.push(p);
  }

  if (dropped.size === 0 && !removedDuplicateIds) return state;

  return {
    ...state,
    panels: kept,
    edges: state.edges.filter(
      (e) => !dropped.has(e.fromPanelId) && !dropped.has(e.toPanelId)
    ),
    selectedPanelIds: state.selectedPanelIds.filter((id) => !dropped.has(id)),
  };
}

export function ensureDefaultPanels(state: CanvasState): CanvasState {
  let s = state;

  // Strip any leftover ingestion panels from persisted state (localStorage
  // may still contain them after this panel type was removed).
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const hadIngestion = s.panels.some((p) => (p as any).type === "ingestion");
  if (hadIngestion) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    s = { ...s, panels: s.panels.filter((p) => (p as any).type !== "ingestion") };
  }

  // Connection panel (always present — hard singleton)
  if (!s.panels.some((p) => p.type === "connection")) {
    const id = `connection-${s.nextPanelId}`;
    s = {
      ...s,
      panels: [
        ...s.panels,
        {
          id,
          type: "connection" as const,
          x: 40,
          y: 40,
          width: CONNECTION_PANEL_SIZE.width,
          height: CONNECTION_PANEL_SIZE.height,
        },
      ],
      nextPanelId: s.nextPanelId + 1,
    };
  }

  // Browse panel is intentionally NOT auto-injected — it stays closed
  // until the user opens it via the Browse pill. (Still a singleton: see
  // dedupSingletonPanels, so only one can exist once opened.)

  return s;
}

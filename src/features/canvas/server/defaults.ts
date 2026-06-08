/**
 * defaults.ts — Canvas state invariants that must hold regardless of how
 * state enters the reducer (via client-side hydration OR server-side
 * pre-render).
 *
 * Extracted from canvas-store.tsx so both the client reducer and the
 * server-side initial-state loader enforce the same rules. Pure
 * functions, no React, no DB.
 *
 *   - `stripFromClusters`: remove panel ids from every cluster, auto-
 *     dissolve clusters that fall below MIN_CLUSTER_SIZE.
 *   - `dedupSingletonPanels`: collapse multiple connection panels to one
 *     (historical bug self-heal).
 *   - `ensureDefaultPanels`: inject the connection default if missing.
 */

import type { CanvasState, Cluster, Panel } from "@/features/canvas/types";
import {
  CONNECTION_PANEL_SIZE,
  MIN_CLUSTER_SIZE,
} from "@/features/canvas/types";

export function stripFromClusters(
  clusters: Cluster[],
  panelIds: ReadonlySet<string>
): Cluster[] {
  const next: Cluster[] = [];
  for (const c of clusters) {
    const remaining = c.panelIds.filter((id) => !panelIds.has(id));
    if (remaining.length === c.panelIds.length) {
      next.push(c);
      continue;
    }
    if (remaining.length < MIN_CLUSTER_SIZE) continue; // auto-dissolve
    next.push({ ...c, panelIds: remaining });
  }
  return next;
}

export function dedupSingletonPanels(state: CanvasState): CanvasState {
  const SINGLETON_TYPES = new Set(["connection"]);
  const seen = new Set<string>();
  const dropped = new Set<string>();
  const kept: Panel[] = [];

  for (const p of state.panels) {
    if (SINGLETON_TYPES.has(p.type)) {
      if (seen.has(p.type)) {
        dropped.add(p.id);
        continue;
      }
      seen.add(p.type);
    }
    kept.push(p);
  }

  if (dropped.size === 0) return state;

  return {
    ...state,
    panels: kept,
    clusters: stripFromClusters(state.clusters, dropped),
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

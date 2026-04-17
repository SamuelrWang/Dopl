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
 *   - `dedupSingletonPanels`: collapse multiple connection/browse panels
 *     to one each (historical bug self-heal).
 *   - `ensureDefaultPanels`: inject connection + browse defaults if
 *     missing. Also strips a legacy "ingestion" panel type.
 */

import type { CanvasState, Cluster, Panel } from "@/components/canvas/types";
import {
  BROWSE_PANEL_SIZE,
  CONNECTION_PANEL_SIZE,
  MIN_CLUSTER_SIZE,
} from "@/components/canvas/types";

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
  const SINGLETON_TYPES = new Set(["connection", "browse"]);
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
          apiKey: null,
        },
      ],
      nextPanelId: s.nextPanelId + 1,
    };
  }

  // Browse panel
  if (!s.panels.some((p) => p.type === "browse")) {
    const id = `browse-${s.nextPanelId}`;
    s = {
      ...s,
      panels: [
        ...s.panels,
        {
          id,
          type: "browse" as const,
          x: 40 + CONNECTION_PANEL_SIZE.width + 32,
          y: 40,
          width: BROWSE_PANEL_SIZE.width,
          height: BROWSE_PANEL_SIZE.height,
        },
      ],
      nextPanelId: s.nextPanelId + 1,
    };
  }

  return s;
}

"use client";

/**
 * useClusterName — on mount, fires a non-blocking POST to /api/cluster/name
 * for the given cluster's member panels and dispatches UPDATE_CLUSTER_NAME
 * when the response arrives. Skips the request if the cluster already has
 * a user-edited name (detected via a startsWithPlaceholder check).
 *
 * The placeholder name "Cluster N" is treated as "needs AI generation".
 * Once the user edits the name manually, it no longer matches the
 * placeholder pattern and this hook will not overwrite it.
 *
 * Designed to be invoked once per cluster creation. The useEffect's empty
 * deps list ensures we don't re-fetch on every rerender.
 */

import { useEffect } from "react";
import { useCanvas } from "../canvas-store";
import type { Cluster, Panel } from "../types";

const PLACEHOLDER_PATTERN = /^Cluster\s+\d+$/i;

/** Shape sent to /api/cluster/name — mirrors the route's expectations. */
interface PanelSummary {
  type: string;
  title?: string;
  summary?: string;
  useCase?: string;
  tags?: string[];
}

function summarisePanel(panel: Panel): PanelSummary {
  const base: PanelSummary = { type: panel.type };
  switch (panel.type) {
    case "chat":
      base.title = panel.title;
      break;
    case "entry":
      base.title = panel.title;
      if (panel.summary) base.summary = panel.summary;
      if (panel.useCase) base.useCase = panel.useCase;
      base.tags = panel.tags.map((t) => `${t.type}:${t.value}`).slice(0, 6);
      break;
    case "connection":
      base.title = "API & MCP Connection";
      break;
    case "ingestion":
      base.title = panel.url || "Ingestion";
      break;
  }
  return base;
}

export function useClusterName(cluster: Cluster): void {
  const { state, dispatch } = useCanvas();

  useEffect(() => {
    if (!PLACEHOLDER_PATTERN.test(cluster.name)) {
      // Either already generated or user-edited — leave it alone.
      return;
    }

    // Gather panel snapshots ONCE at effect start; don't follow state.panels
    // changes mid-request.
    const panels = state.panels
      .filter((p) => cluster.panelIds.includes(p.id))
      .map(summarisePanel);

    if (panels.length === 0) return;

    let cancelled = false;
    fetch("/api/cluster/name", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ panels }),
    })
      .then((r) => (r.ok ? r.json() : null))
      .then((data: { name?: string } | null) => {
        if (cancelled) return;
        if (data?.name) {
          dispatch({
            type: "UPDATE_CLUSTER_NAME",
            clusterId: cluster.id,
            name: data.name,
          });
        }
      })
      .catch(() => {
        // Silent — placeholder stays, user can rename manually.
      });

    return () => {
      cancelled = true;
    };
    // Intentionally run once per cluster — we don't want to re-fetch on
    // every state change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cluster.id]);
}

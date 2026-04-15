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
 * After the AI name is generated, a second effect syncs it to the backend
 * so the MCP server sees a meaningful name/slug instead of "Cluster_1".
 *
 * Designed to be invoked once per cluster creation. The useEffect's empty
 * deps list ensures we don't re-fetch on every rerender.
 */

import { useEffect, useRef } from "react";
import { useCanvas } from "../canvas-store";
import type { Cluster, Panel } from "../types";

const PLACEHOLDER_PATTERN = /^Cluster[_\s]+\d+$/i;

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
  }
  return base;
}

export function useClusterName(cluster: Cluster): void {
  const { state, dispatch } = useCanvas();
  const syncedRef = useRef(false);

  // Effect 1: Generate AI name (runs once on mount)
  useEffect(() => {
    if (!PLACEHOLDER_PATTERN.test(cluster.name)) {
      return;
    }

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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cluster.id]);

  // Effect 2: Sync AI-generated name to backend once slug is available.
  // Runs when cluster.name or cluster.slug changes. The ref ensures we
  // only sync once per cluster lifecycle.
  useEffect(() => {
    if (syncedRef.current) return;
    if (!cluster.slug) return;
    if (PLACEHOLDER_PATTERN.test(cluster.name)) return;

    syncedRef.current = true;

    fetch(`/api/clusters/${encodeURIComponent(cluster.slug)}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: cluster.name }),
    })
      .then((res) => res.json())
      .then((updated) => {
        if (updated.slug && updated.slug !== cluster.slug) {
          dispatch({
            type: "UPDATE_CLUSTER_DB_INFO",
            clusterId: cluster.id,
            dbId: updated.id,
            slug: updated.slug,
          });
        }
      })
      .catch(() => {
        // Silent — name is correct in UI, backend sync is best-effort
      });
  }, [cluster.slug, cluster.name, cluster.id, dispatch]);
}

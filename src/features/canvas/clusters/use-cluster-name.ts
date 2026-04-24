"use client";

/**
 * useClusterName — assign a deterministic display name to a freshly
 * created cluster and sync it to the backend.
 *
 * The old hook POSTed cluster member summaries to `/api/cluster/name`
 * which ran a server-side Claude call to auto-generate a name. That
 * route has been retired as part of the client-only-LLM pivot: nothing
 * on the server runs Claude for us anymore. This hook now derives a
 * name locally from the panels and lets the user or a connected MCP
 * agent rename it via the `rename_cluster` MCP tool.
 *
 * Name-derivation heuristics, in order:
 *   1. If there's one entry panel: use its title (truncated).
 *   2. If there are 2+ entry panels: use the first entry's title +
 *      "and N more".
 *   3. Fallback: "Cluster of N items" — guaranteed non-empty.
 *
 * The user keeps the placeholder "Cluster N" format locked until this
 * hook runs once; after that, the returned name is editable and no
 * further auto-naming will occur.
 */

import { useEffect, useRef } from "react";
import { useCanvas } from "../canvas-store";
import type { Cluster, Panel } from "../types";

const PLACEHOLDER_PATTERN = /^Cluster[_\s]+\d+$/i;
const MAX_NAME_CHARS = 40;

function deriveClusterName(panels: Panel[]): string {
  const entryTitles = panels
    .filter((p) => p.type === "entry")
    .map((p) => (p as Extract<Panel, { type: "entry" }>).title)
    .filter((t): t is string => typeof t === "string" && t.length > 0);

  if (entryTitles.length === 0) {
    return `Cluster of ${panels.length} items`;
  }

  const primary = entryTitles[0];
  const truncated =
    primary.length > MAX_NAME_CHARS
      ? primary.slice(0, MAX_NAME_CHARS - 1).trimEnd() + "…"
      : primary;

  if (entryTitles.length === 1) return truncated;
  const extra = entryTitles.length - 1;
  return `${truncated} +${extra}`;
}

export function useClusterName(cluster: Cluster): void {
  const { state, dispatch } = useCanvas();
  const syncedRef = useRef(false);
  const namedRef = useRef(false);

  // Effect 1: Assign a deterministic name once on mount (only if the
  // current name is still the "Cluster N" placeholder).
  useEffect(() => {
    if (namedRef.current) return;
    if (!PLACEHOLDER_PATTERN.test(cluster.name)) return;

    const memberPanels = state.panels.filter((p) =>
      cluster.panelIds.includes(p.id)
    );
    if (memberPanels.length === 0) return;

    namedRef.current = true;
    const derived = deriveClusterName(memberPanels);
    dispatch({
      type: "UPDATE_CLUSTER_NAME",
      clusterId: cluster.id,
      name: derived,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cluster.id]);

  // Effect 2: Sync the name to the backend once the slug is available.
  // Runs when cluster.name or cluster.slug changes; the ref guarantees
  // one network call per cluster lifecycle.
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
        // Silent — UI name is already correct; backend sync is best-effort.
      });
  }, [cluster.slug, cluster.name, cluster.id, dispatch]);
}

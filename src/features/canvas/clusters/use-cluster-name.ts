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
 *   1. Collect a label from each content panel — entry/artifact titles and
 *      knowledge-base/skill names (chat, browse, connection, and the
 *      singleton browsers contribute none).
 *   2. One label: use it (truncated). 2+ labels: first label + "+N".
 *   3. Fallback: "Cluster of N items" — only when no panel has a label.
 *
 * The user keeps the placeholder "Cluster N" format locked until this
 * hook runs once; after that, the returned name is editable and no
 * further auto-naming will occur.
 */

import { useEffect, useRef } from "react";
import { useCanvas } from "../canvas-store";
import { normalizeClusterName } from "@/shared/lib/cluster-name";
import type { Cluster, Panel } from "../types";

const PLACEHOLDER_PATTERN = /^Cluster[_\s]+\d+$/i;
const MAX_NAME_CHARS = 40;

/**
 * Extract a human label from a content panel: entry/artifact titles and
 * knowledge-base/skill names. Returns null for panels with no meaningful
 * label (chat, browse, connection, and the singleton KB/skill browsers).
 */
function panelLabel(p: Panel): string | null {
  switch (p.type) {
    case "entry":
    case "artifact":
      return p.title && p.title.trim().length > 0 ? p.title.trim() : null;
    case "knowledge-base":
    case "skill":
      return p.name && p.name.trim().length > 0 ? p.name.trim() : null;
    default:
      return null;
  }
}

function deriveClusterName(panels: Panel[]): string {
  const labels = panels
    .map(panelLabel)
    .filter((t): t is string => t !== null);

  if (labels.length === 0) {
    return `Cluster of ${panels.length} items`;
  }

  const primary = labels[0];
  const truncated =
    primary.length > MAX_NAME_CHARS
      ? primary.slice(0, MAX_NAME_CHARS - 1).trimEnd() + "…"
      : primary;

  if (labels.length === 1) return truncated;
  return `${truncated} +${labels.length - 1}`;
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
    const derived = normalizeClusterName(deriveClusterName(memberPanels));
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

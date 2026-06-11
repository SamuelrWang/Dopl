"use client";

import { useCallback, useEffect, useState } from "react";
import type { AccessMatrixResource } from "@/features/teams/types";

export interface UseWorkspaceResourcesResult {
  resources: AccessMatrixResource[] | null;
  loading: boolean;
  error: string | null;
  refresh: () => void;
}

/**
 * Fetches every grantable resource (knowledge bases + workflows, with
 * name + access mode) from GET /api/workspaces/[slug]/access-matrix.
 * Feeds the Access tab columns, the team drawer's grant rows, and the
 * member drawer's effective-access list.
 */
export function useWorkspaceResources(
  workspaceSlug: string
): UseWorkspaceResourcesResult {
  const [resources, setResources] = useState<AccessMatrixResource[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetch(`/api/workspaces/${encodeURIComponent(workspaceSlug)}/access-matrix`, {
      credentials: "same-origin",
    })
      .then(async (res) => {
        if (cancelled) return;
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          throw new Error(
            body?.error?.message || body?.error || "Failed to load resources"
          );
        }
        const body = (await res.json()) as { resources: AccessMatrixResource[] };
        if (!cancelled) {
          setResources(body.resources ?? []);
          setError(null);
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setError(
            err instanceof Error ? err.message : "Failed to load resources"
          );
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [workspaceSlug, tick]);

  const refresh = useCallback(() => setTick((t) => t + 1), []);
  return { resources, loading, error, refresh };
}

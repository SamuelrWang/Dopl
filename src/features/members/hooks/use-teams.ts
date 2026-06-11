"use client";

import { useCallback, useEffect, useState } from "react";
import type { TeamView } from "@/features/teams/types";

export interface UseTeamsResult {
  teams: TeamView[] | null;
  loading: boolean;
  error: string | null;
  refresh: () => void;
}

/**
 * Fetches the workspace's teams (with member ids + grants) from
 * GET /api/workspaces/[slug]/teams. Same useEffect + cancelled-flag +
 * tick-refresh shape as `useMembers`.
 */
export function useTeams(workspaceSlug: string): UseTeamsResult {
  const [teams, setTeams] = useState<TeamView[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetch(`/api/workspaces/${encodeURIComponent(workspaceSlug)}/teams`, {
      credentials: "same-origin",
    })
      .then(async (res) => {
        if (cancelled) return;
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          throw new Error(body?.error?.message || body?.error || "Failed to load teams");
        }
        const body = (await res.json()) as { teams: TeamView[] };
        if (!cancelled) {
          setTeams(body.teams ?? []);
          setError(null);
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Failed to load teams");
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
  return { teams, loading, error, refresh };
}

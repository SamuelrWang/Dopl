"use client";

import { useApiQuery } from "@/shared/hooks/use-api-query";
import { teamsPath } from "../client/query-keys";
import type { TeamsCache } from "../lib/optimistic-cache";

const selectTeams = (body: TeamsCache) => body.teams ?? [];

/** Workspace teams (with member ids + grants). Key owned by `client/query-keys`. */
export function useTeams(workspaceSlug: string) {
  const query = useApiQuery(teamsPath(workspaceSlug), { select: selectTeams });
  return {
    teams: query.data ?? null,
    loading: query.isPending,
    error: query.error ? query.error.message : null,
    refresh: query.refetch,
  };
}

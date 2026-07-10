"use client";

import { useApiQuery } from "@/shared/hooks/use-api-query";
import type { TeamView } from "@/features/teams/types";

const selectTeams = (body: { teams: TeamView[] }) => body.teams ?? [];

/** Workspace teams (with member ids + grants). */
export function useTeams(workspaceSlug: string) {
  const query = useApiQuery(
    `/api/workspaces/${encodeURIComponent(workspaceSlug)}/teams`,
    { select: selectTeams }
  );
  return {
    teams: query.data ?? null,
    loading: query.isPending,
    error: query.error ? query.error.message : null,
    refresh: query.refetch,
  };
}

"use client";

import { useApiGet } from "@/shared/hooks/use-api-get";
import type { TeamView } from "@/features/teams/types";

/** Workspace teams (with member ids + grants). */
export function useTeams(workspaceSlug: string) {
  const { data, loading, error, refresh } = useApiGet(
    `/api/workspaces/${encodeURIComponent(workspaceSlug)}/teams`,
    (body) => (body as { teams: TeamView[] }).teams ?? []
  );
  return { teams: data, loading, error, refresh };
}

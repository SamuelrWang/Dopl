"use client";

import { useApiQuery } from "@/shared/hooks/use-api-query";
import type { AccessMatrixResource } from "@/features/teams/types";

const selectResources = (body: { resources: AccessMatrixResource[] }) =>
  body.resources ?? [];

/**
 * Every grantable resource (knowledge bases + workflows, with name +
 * access mode) from the access matrix. Feeds the Access tab columns,
 * the team drawer's grant rows, and the member drawer.
 */
export function useWorkspaceResources(workspaceSlug: string) {
  const query = useApiQuery(
    `/api/workspaces/${encodeURIComponent(workspaceSlug)}/access-matrix`,
    { select: selectResources }
  );
  return {
    resources: query.data ?? null,
    loading: query.isPending,
    error: query.error ? query.error.message : null,
    refresh: query.refetch,
  };
}

"use client";

import { useApiGet } from "@/shared/hooks/use-api-get";
import type { AccessMatrixResource } from "@/features/teams/types";

/**
 * Every grantable resource (knowledge bases + workflows, with name +
 * access mode) from the access matrix. Feeds the Access tab columns,
 * the team drawer's grant rows, and the member drawer.
 */
export function useWorkspaceResources(workspaceSlug: string) {
  const { data, loading, error, refresh } = useApiGet(
    `/api/workspaces/${encodeURIComponent(workspaceSlug)}/access-matrix`,
    (body) => (body as { resources: AccessMatrixResource[] }).resources ?? []
  );
  return { resources: data, loading, error, refresh };
}

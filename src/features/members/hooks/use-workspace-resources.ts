"use client";

import { useApiQuery } from "@/shared/hooks/use-api-query";
import { withoutRetiredResources } from "@/features/teams/access-levels";
import { accessMatrixPath } from "../client/query-keys";
import type { ResourcesCache } from "../lib/optimistic-cache";

/**
 * ⚠ Where workflows leave the access-matrix INVENTORY. `workflow` stays a
 * valid grantable type in the DB and in the payload; it only stops rendering,
 * and it must stop HERE rather than per-component because the members console
 * DERIVES the Access tab's default selection from `resourceList[0]` (a
 * workflow left in would open with no click) and `create-team-dialog` builds
 * its grant rows from the same array.
 * ⚠ The matrix has a SECOND half this does not reach — each team's `grants`,
 * filtered per-pane. Predicate lives in
 * `teams/access-levels`.
 */
const selectResources = (body: ResourcesCache) =>
  withoutRetiredResources(body.resources ?? []);

/** Grantable resources the UI still renders (KBs + skills, name + access
 *  mode). Feeds the Access tab, team detail grant rows, create-team dialog. */
export function useWorkspaceResources(workspaceSlug: string) {
  const query = useApiQuery(accessMatrixPath(workspaceSlug), {
    select: selectResources,
  });
  return {
    resources: query.data ?? null,
    loading: query.isPending,
    error: query.error ? query.error.message : null,
    refresh: query.refetch,
  };
}

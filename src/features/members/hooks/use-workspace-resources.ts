"use client";

import { useApiQuery } from "@/shared/hooks/use-api-query";
import { withoutRetiredResources } from "@/features/teams/access-levels";
import { accessMatrixPath } from "../client/query-keys";
import type { ResourcesCache } from "../lib/optimistic-cache";

/**
 * WHERE WORKFLOWS LEAVE THE ACCESS-MATRIX INVENTORY (retirement D7).
 *
 * `workflow` stays a valid grantable type in the DB and in the access-matrix
 * payload — existing grant rows keep working and nothing is migrated. It just
 * stops rendering, and it stops here rather than in each component because the
 * console's surfaces read this list for more than display: `members-view`
 * DERIVES the Access tab's default selection from `resourceList[0]`, so a
 * workflow left in the array would open in the detail pane with no click.
 * `create-team-dialog` builds its grant rows from the same array.
 *
 * The matrix has a SECOND half this does not reach — each team's `grants`
 * array, filtered where those are rendered (`members-list-pane`,
 * `member-detail`). The predicate itself lives in `teams/access-levels`.
 */
const selectResources = (body: ResourcesCache) =>
  withoutRetiredResources(body.resources ?? []);

/**
 * Every grantable resource the UI still renders (knowledge bases + skills,
 * with name + access mode) from the access matrix. Feeds the Access tab,
 * the team detail's grant rows, and the create-team dialog.
 */
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

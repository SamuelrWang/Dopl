"use client";

import { useApiQuery } from "@/shared/hooks/use-api-query";
import { membersPath } from "../client/query-keys";
import type { MembersCache } from "../lib/optimistic-cache";

const selectMembers = (body: MembersCache) => body.members ?? [];

/** Workspace members list, hydrated. ⚠ Path comes from `client/query-keys` so
 *  this read and the writes that patch it can't disagree by a character. */
export function useMembers(workspaceSlug: string) {
  const query = useApiQuery(membersPath(workspaceSlug), {
    select: selectMembers,
  });
  return {
    members: query.data ?? null,
    loading: query.isPending,
    error: query.error ? query.error.message : null,
    refresh: query.refetch,
  };
}

"use client";

import { useApiQuery } from "@/shared/hooks/use-api-query";
import type { WorkspaceMemberView } from "../types";

const selectMembers = (body: { members: WorkspaceMemberView[] }) =>
  body.members ?? [];

/** Workspace members list (email/displayName/avatar hydrated). */
export function useMembers(workspaceSlug: string) {
  const query = useApiQuery(
    `/api/workspaces/${encodeURIComponent(workspaceSlug)}/members`,
    { select: selectMembers }
  );
  return {
    members: query.data ?? null,
    loading: query.isPending,
    error: query.error ? query.error.message : null,
    refresh: query.refetch,
  };
}

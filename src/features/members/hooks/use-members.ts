"use client";

import { useApiGet } from "@/shared/hooks/use-api-get";
import type { WorkspaceMemberView } from "../types";

/** Workspace members list (email/displayName/avatar hydrated). */
export function useMembers(workspaceSlug: string) {
  const { data, loading, error, refresh } = useApiGet(
    `/api/workspaces/${encodeURIComponent(workspaceSlug)}/members`,
    (body) => (body as { members: WorkspaceMemberView[] }).members ?? []
  );
  return { members: data, loading, error, refresh };
}

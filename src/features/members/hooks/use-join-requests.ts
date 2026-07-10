"use client";

import { useCallback } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/shared/api/api-client";
import { useApiQuery } from "@/shared/hooks/use-api-query";
import type { AssignableRole } from "../types";

export interface JoinRequestView {
  id: string;
  userId: string;
  requestedAt: string;
  email: string | null;
  displayName: string | null;
  avatarUrl: string | null;
}

const selectRequests = (body: { requests: JoinRequestView[] }) =>
  body.requests ?? [];

/**
 * Pending join-link requests + approve/decline actions. Fetches only
 * when `enabled` (the endpoint is admin-gated server-side); disabled
 * callers get an empty list and no network traffic.
 */
export function useJoinRequests(workspaceSlug: string, enabled: boolean) {
  const path = `/api/workspaces/${encodeURIComponent(workspaceSlug)}/join-requests`;
  const queryClient = useQueryClient();
  const query = useApiQuery(path, { select: selectRequests, enabled });

  const resolve = useCallback(
    async (requestId: string, action: "approve" | "decline", role: AssignableRole) => {
      await apiRequest<void>(`${path}/${encodeURIComponent(requestId)}`, {
        method: "PATCH",
        body: action === "approve" ? { action, role } : { action },
      });
      // Optimistically drop the resolved row from the cached list.
      queryClient.setQueryData(
        [path, undefined, undefined],
        (prev: { requests: JoinRequestView[] } | undefined) =>
          prev
            ? { requests: (prev.requests ?? []).filter((r) => r.id !== requestId) }
            : prev
      );
    },
    [path, queryClient]
  );

  return {
    requests: enabled ? (query.data ?? []) : [],
    refresh: query.refetch,
    resolve,
  };
}

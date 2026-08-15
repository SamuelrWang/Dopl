"use client";

import {
  patchCache,
  useApiMutation,
  type UseApiMutationConfig,
} from "@/shared/hooks/use-api-mutation";
import { useApiQuery } from "@/shared/hooks/use-api-query";
import { useInvalidateBillingStatus } from "@/features/billing/components/use-workspace-entitlements";
import {
  joinRequestPath,
  joinRequestsPath,
  memberKeys,
} from "../client/query-keys";
import {
  dropJoinRequest,
  type JoinRequestsCache,
} from "../lib/optimistic-cache";
import type { AssignableRole, JoinRequestView } from "../types";

/** Re-exported so the queue components keep their existing import. */
export type { JoinRequestView };

const selectRequests = (body: JoinRequestsCache) => body.requests ?? [];

export interface ResolveJoinRequestDraft {
  /** Captured at submit — the row this decision belongs to. */
  requestId: string;
  action: "approve" | "decline";
  role: AssignableRole;
}

export function resolveJoinRequestConfig(
  workspaceSlug: string,
  onSeatsChanged: () => void
): UseApiMutationConfig<ResolveJoinRequestDraft, unknown> {
  return {
    request: (draft) => ({
      path: joinRequestPath(workspaceSlug, draft.requestId),
      method: "PATCH",
      body:
        draft.action === "approve"
          ? { action: draft.action, role: draft.role }
          : { action: draft.action },
    }),
    optimistic: (draft) =>
      patchCache<JoinRequestsCache>(
        memberKeys.joinRequests(workspaceSlug).all,
        (cache) => dropJoinRequest(cache, draft.requestId)
      ),
    // ⚠ An approval mints a `workspace_members` row this client can't compose
    // (server join time, hydrated profile, seat gate), so the roster is the one
    // cache it may not reconcile. A decline touches only the queue.
    invalidate: (draft) =>
      draft.action === "approve" ? [memberKeys.members(workspaceSlug).all] : [],
    onSuccess: (_data, draft) => {
      if (draft.action === "approve") onSeatsChanged();
    },
  };
}

/**
 * Pending join-link requests + the approve/decline decision.
 * ⚠ The row drop must stay in `onMutate`: dropping after the await leaves both
 * buttons live for the length of the PATCH, and a second click fires a second
 * decision. A failure restores the queue from the layer's snapshot.
 * An APPROVAL adds a member and Team bills per seat, so it invalidates billing
 * status on success; a decline adds nobody and does not.
 * Fetches only when `enabled` (endpoint is admin-gated server-side).
 */
export function useJoinRequests(workspaceSlug: string, enabled: boolean) {
  const invalidateBilling = useInvalidateBillingStatus();
  const query = useApiQuery(joinRequestsPath(workspaceSlug), {
    select: selectRequests,
    enabled,
  });

  const resolveMutation = useApiMutation(
    resolveJoinRequestConfig(workspaceSlug, () => void invalidateBilling())
  );

  return {
    requests: enabled ? (query.data ?? []) : [],
    refresh: query.refetch,
    /** Rejects with the transport's `ApiError` so callers can still match
     *  `SOLO_MEMBER_LIMIT` and offer the in-place Team upgrade. */
    resolve: (
      requestId: string,
      action: "approve" | "decline",
      role: AssignableRole
    ) => resolveMutation.mutateAsync({ requestId, action, role }),
    resolving: resolveMutation.pending,
  };
}

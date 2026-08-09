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
    // An approval mints a `workspace_members` row this client cannot compose
    // (server-assigned join time, hydrated profile, seat gate) — the roster is
    // the one cache the write may not reconcile. A decline touches nothing but
    // the queue it already patched.
    invalidate: (draft) =>
      draft.action === "approve" ? [memberKeys.members(workspaceSlug).all] : [],
    onSuccess: (_data, draft) => {
      if (draft.action === "approve") onSeatsChanged();
    },
  };
}

/**
 * Pending join-link requests + the approve/decline decision.
 *
 * WHAT CHANGED (launch audit §5, "zero-feedback controls"): the cache write
 * that drops the resolved row already existed — it just ran AFTER the await, so
 * for the length of the PATCH the row stayed on screen with both of its buttons
 * live, and a second click fired a second decision. Moving the drop into
 * `onMutate` is the whole fix: the row is gone one frame after the click, which
 * removes the double-fire by removing the buttons, and a failure restores the
 * queue verbatim from the layer's snapshot instead of leaving it wrong.
 *
 * F-045: an APPROVAL adds a member, and Team bills per seat, so it invalidates
 * the billing status on success. A decline adds nobody and does not.
 *
 * Fetches only when `enabled` (the endpoint is admin-gated server-side);
 * disabled callers get an empty list and no network traffic.
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
    /**
     * Rejects with the transport's `ApiError`, so callers keep matching
     * `SOLO_MEMBER_LIMIT` to offer the in-place Team upgrade.
     */
    resolve: (
      requestId: string,
      action: "approve" | "decline",
      role: AssignableRole
    ) => resolveMutation.mutateAsync({ requestId, action, role }),
    resolving: resolveMutation.pending,
  };
}

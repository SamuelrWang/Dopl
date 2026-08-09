"use client";

import {
  patchCache,
  useApiMutation,
  type ApiMutation,
  type UseApiMutationConfig,
} from "@/shared/hooks/use-api-mutation";
import { useInvalidateBillingStatus } from "@/features/billing/components/use-workspace-entitlements";
import { memberKeys, memberPath } from "../client/query-keys";
import {
  dropMember,
  dropMemberFromTeams,
  setMemberRole,
  type MembersCache,
  type TeamsCache,
} from "../lib/optimistic-cache";
import type { AssignableRole } from "../types";

/**
 * The two WORKSPACE-MEMBERSHIP writes — change a role, remove a member —
 * on the shared mutation layer.
 *
 * What they were: `setBusy(true); await updateMemberRole(); onChanged()`, where
 * `onChanged` refetched the roster. The role select therefore rendered the OLD
 * role for the whole round trip while disabled — the stale-value class in the
 * launch audit — and the removed member sat in the list until a second network
 * hop answered. Both caches are now patched before the request leaves, and a
 * failure restores the exact snapshot.
 *
 * F-045 CLOSES HERE. `useInvalidateBillingStatus` was exported in July with
 * zero callers, so seat and member counts went stale after every membership
 * change and the entitlements read papered over it with a 5s `staleTime`. A
 * removal is a real seat change (Team bills per seat, and the seats reconcile
 * against membership), so it invalidates the billing status on SUCCESS —
 * `onSuccess`, not `invalidate`, because a removal that FAILED changed no
 * seats and re-downloading the entitlements would be a wasted round trip.
 */

export interface MemberRoleDraft {
  /** Captured at submit; never re-read from the selection. */
  userId: string;
  role: AssignableRole;
}

export interface RemoveMemberDraft {
  userId: string;
}

export function memberRoleConfig(
  workspaceSlug: string
): UseApiMutationConfig<MemberRoleDraft, unknown> {
  return {
    request: (draft) => ({
      path: memberPath(workspaceSlug, draft.userId),
      method: "PATCH",
      body: { role: draft.role },
    }),
    optimistic: (draft) =>
      patchCache<MembersCache>(memberKeys.members(workspaceSlug).all, (cache) =>
        setMemberRole(cache, draft.userId, draft.role)
      ),
    // Role sets the CEILING on effective access and short-circuits entirely
    // for admins, so the member's server-resolved access pane is the one cache
    // this write cannot compute. It has its own key and, before the console
    // was converted, no writer anywhere in the app.
    invalidate: (draft) => [
      memberKeys.memberAccess(workspaceSlug, draft.userId).all,
    ],
  };
}

export function removeMemberConfig(
  workspaceSlug: string,
  onSeatsChanged: () => void
): UseApiMutationConfig<RemoveMemberDraft, unknown> {
  return {
    request: (draft) => ({
      path: memberPath(workspaceSlug, draft.userId),
      method: "DELETE",
    }),
    // Both caches are snapshotted together in `onMutate`, so a failed removal
    // puts the member back in the roster AND back in their teams — rather than
    // leaving teams that have forgotten a member the roster still lists.
    optimistic: (draft) => [
      patchCache<MembersCache>(memberKeys.members(workspaceSlug).all, (cache) =>
        dropMember(cache, draft.userId)
      ),
      patchCache<TeamsCache>(memberKeys.teams(workspaceSlug).all, (cache) =>
        dropMemberFromTeams(cache, draft.userId)
      ),
    ],
    onSuccess: onSeatsChanged,
  };
}

export interface MemberWrites {
  setRole: ApiMutation<MemberRoleDraft, unknown>;
  remove: ApiMutation<RemoveMemberDraft, unknown>;
  /** True while either write is in flight. */
  pending: boolean;
}

export function useMemberWrites(workspaceSlug: string): MemberWrites {
  const invalidateBilling = useInvalidateBillingStatus();
  const setRole = useApiMutation(memberRoleConfig(workspaceSlug));
  const remove = useApiMutation(
    removeMemberConfig(workspaceSlug, () => void invalidateBilling())
  );
  return { setRole, remove, pending: setRole.pending || remove.pending };
}

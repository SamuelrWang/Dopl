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
 * The two workspace-membership writes — change a role, remove a member — on
 * the shared mutation layer. Both caches are patched before the request
 * leaves; a failure restores the exact snapshot.
 * ⚠ A removal is a real seat change (Team bills per seat and seats reconcile
 * against membership), so it invalidates billing status in `onSuccess` — not
 * `invalidate`, because a FAILED removal moved no seats and re-downloading
 * entitlements would be a wasted round trip.
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
    // ⚠ Role sets the CEILING on effective access and short-circuits for
    // admins, so the member's server-resolved access pane (its own key) is the
    // one cache this write cannot compute.
    // The activity feed gains a `member.role_changed` row this write cannot
    // compute either.
    invalidate: (draft) => [
      memberKeys.memberAccess(workspaceSlug, draft.userId).all,
      memberKeys.memberActivity(workspaceSlug, draft.userId).all,
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
    // ⚠ Both caches snapshot together in `onMutate`, so a failed removal
    // restores roster AND teams — otherwise teams forget a member the roster
    // still lists.
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

"use client";

import {
  patchCache,
  useApiMutation,
  type ApiMutation,
  type UseApiMutationConfig,
} from "@/shared/hooks/use-api-mutation";
import { toast } from "@/shared/ui/toast";
import { invitationPath, joinLinkPath, memberKeys } from "../client/query-keys";
import {
  dropInvitation,
  type InvitationsCache,
  type JoinLinkCache,
} from "../lib/optimistic-cache";

/**
 * Invitation writes: revoke a pending invitation, rotate the shareable join
 * link. Revoke drops the row before the request leaves; the layer's snapshot
 * puts it back if the DELETE fails.
 * ⚠ Reset link has NO optimistic patch: only the server can mint the token,
 * and a placeholder would put a dead invite URL on screen to copy. It uses
 * `pending` instead, and the reconcile folds the POST's answer into the read's
 * cache with no refetch.
 * Configs are exported as PURE FACTORIES so tests can drive them through
 * TanStack's own `MutationObserver`.
 */

export interface RevokeInvitationDraft {
  invitationId: string;
}

export function revokeInvitationConfig(
  workspaceSlug: string
): UseApiMutationConfig<RevokeInvitationDraft, unknown> {
  const invitationsKey = memberKeys.invitations(workspaceSlug).all;
  return {
    request: (draft) => ({
      path: invitationPath(workspaceSlug, draft.invitationId),
      method: "DELETE",
    }),
    // ⚠ PREFIX key, not the exact tuple: the pending list is read by the
    // console's list pane AND the settings modal's members tab, which mount
    // independently and may hold separate cache entries.
    optimistic: (draft) =>
      patchCache<InvitationsCache>(invitationsKey, (cache) =>
        dropInvitation(cache, draft.invitationId)
      ),
    // The row reappearing IS the failure state; the toast only says why.
    onError: (err) =>
      toast({
        title:
          err instanceof Error ? err.message : "Couldn't revoke invitation",
      }),
  };
}

export function resetJoinLinkConfig(
  workspaceSlug: string
): UseApiMutationConfig<void, JoinLinkCache> {
  const joinLinkKey = memberKeys.joinLink(workspaceSlug).all;
  return {
    request: () => ({ path: joinLinkPath(workspaceSlug), method: "POST" }),
    reconcile: (data) => patchCache<JoinLinkCache>(joinLinkKey, () => data),
    // ⚠ Keep the current link on failure — a reset that didn't happen must
    // not leave the admin believing the old URL is dead.
    onError: (err) =>
      toast({
        title: err instanceof Error ? err.message : "Couldn't reset the link",
      }),
  };
}

export interface InvitationWrites {
  revoke: ApiMutation<RevokeInvitationDraft, unknown>;
  resetLink: ApiMutation<void, JoinLinkCache>;
}

export function useInvitationWrites(workspaceSlug: string): InvitationWrites {
  return {
    revoke: useApiMutation(revokeInvitationConfig(workspaceSlug)),
    resetLink: useApiMutation(resetJoinLinkConfig(workspaceSlug)),
  };
}

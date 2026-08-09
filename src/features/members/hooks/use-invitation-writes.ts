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
 * INVITATION writes: revoke a pending invitation, and rotate the shareable
 * join link.
 *
 * REVOKE was the launch audit's headline dead control — "literally nothing
 * happens on click". It awaited a DELETE and then refetched, and the refetch
 * was the only thing that could remove the row, so the ✕ produced no pixel
 * change at all for two network hops. It drops the row before the request
 * leaves now; the layer's snapshot puts it back if the DELETE fails.
 *
 * RESET LINK is the honest opposite case: only the server can mint the new
 * token, so there is nothing to patch optimistically and inventing a
 * placeholder token would put a DEAD invite URL on screen for the user to copy.
 * What was wrong was showing the OLD url — a working link the admin believes
 * they have just invalidated — so the fix is `pending`, and the reconcile folds
 * the POST's own answer straight into the read's cache with no refetch.
 *
 * The two configs are exported as PURE FACTORIES so the tests can drive them
 * through TanStack's own `MutationObserver` rather than a re-implementation of
 * the onMutate → mutationFn → onError order they depend on.
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
    // The PREFIX key, not the exact tuple: the pending list is read by the
    // console's list pane and by the settings modal's members tab, which mount
    // independently and may hold separate cache entries.
    optimistic: (draft) =>
      patchCache<InvitationsCache>(invitationsKey, (cache) =>
        dropInvitation(cache, draft.invitationId)
      ),
    // The row reappearing IS the failure state, so the toast only has to say
    // why — same division of labour as the channels writes.
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
    // Keep the current link on failure — a reset that did not happen must not
    // leave the admin believing the old URL is dead.
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

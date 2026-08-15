"use client";

import { useApiQuery } from "@/shared/hooks/use-api-query";
import { invitationsPath } from "../client/query-keys";
import type { InvitationsCache } from "../lib/optimistic-cache";

/** ⚠ This SELECTOR hides accepted/revoked rows but the cache still holds
 *  them: patch the raw `{ invitations: [...] }` body, never what this
 *  returns. */
const selectPending = (body: InvitationsCache) =>
  (body.invitations ?? []).filter((i) => !i.acceptedAt && !i.revokedAt);

/** Pending invitations for the admin members panel. Disabled for non-admins,
 *  who can't read the list. */
export function useInvitations(workspaceSlug: string, enabled: boolean) {
  const query = useApiQuery(invitationsPath(workspaceSlug), {
    select: selectPending,
    enabled,
  });
  return {
    invitations: query.data ?? null,
    // Disabled (non-admin) callers are "not loading", not pending forever.
    loading: enabled && query.isPending,
    error: query.error ? query.error.message : null,
    refresh: query.refetch,
  };
}

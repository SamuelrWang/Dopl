"use client";

import { useApiQuery } from "@/shared/hooks/use-api-query";
import { invitationsPath } from "../client/query-keys";
import type { InvitationsCache } from "../lib/optimistic-cache";

/**
 * NOTE for writers: this SELECTOR hides accepted/revoked rows, but the cache
 * still holds them — an optimistic patch operates on the raw
 * `{ invitations: [...] }` body, never on what this returns.
 */
const selectPending = (body: InvitationsCache) =>
  (body.invitations ?? []).filter((i) => !i.acceptedAt && !i.revokedAt);

/**
 * Pending workspace invitations for the admin members panel. Disabled
 * for non-admins, who can't read this list. Accepted/revoked rows are
 * filtered out so the UI only shows actionable invites.
 */
export function useInvitations(workspaceSlug: string, enabled: boolean) {
  const query = useApiQuery(invitationsPath(workspaceSlug), {
    select: selectPending,
    enabled,
  });
  return {
    invitations: query.data ?? null,
    // Disabled (non-admin) callers are "not loading", not pending-forever.
    loading: enabled && query.isPending,
    error: query.error ? query.error.message : null,
    refresh: query.refetch,
  };
}

"use client";

import { useApiQuery } from "@/shared/hooks/use-api-query";
import type { WorkspaceInvitationView } from "../types";

const selectPending = (body: { invitations: WorkspaceInvitationView[] }) =>
  (body.invitations ?? []).filter((i) => !i.acceptedAt && !i.revokedAt);

/**
 * Pending workspace invitations for the admin members panel. Disabled
 * for non-admins, who can't read this list. Accepted/revoked rows are
 * filtered out so the UI only shows actionable invites.
 */
export function useInvitations(workspaceSlug: string, enabled: boolean) {
  const query = useApiQuery(
    `/api/workspaces/${encodeURIComponent(workspaceSlug)}/invitations`,
    { select: selectPending, enabled }
  );
  return {
    invitations: query.data ?? null,
    // Disabled (non-admin) callers are "not loading", not pending-forever.
    loading: enabled && query.isPending,
    error: query.error ? query.error.message : null,
    refresh: query.refetch,
  };
}

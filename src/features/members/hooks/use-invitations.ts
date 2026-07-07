"use client";

import { useApiGet } from "@/shared/hooks/use-api-get";
import type { WorkspaceInvitationView } from "../types";

/**
 * Pending workspace invitations for the admin members panel. Disabled
 * (null url) for non-admins, who can't read this list. Accepted/revoked
 * rows are filtered out so the UI only shows actionable invites.
 */
export function useInvitations(workspaceSlug: string, enabled: boolean) {
  const { data, loading, error, refresh } = useApiGet(
    enabled
      ? `/api/workspaces/${encodeURIComponent(workspaceSlug)}/invitations`
      : null,
    (body) =>
      ((body as { invitations: WorkspaceInvitationView[] }).invitations ?? []).filter(
        (i) => !i.acceptedAt && !i.revokedAt
      )
  );
  return { invitations: data, loading, error, refresh };
}

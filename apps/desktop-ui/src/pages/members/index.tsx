import { MembersView } from "@/features/members/components/members-view";
import { PageError, PageLoading } from "#/components/page-states";
import { useWorkspaceAccess } from "#/hooks/use-workspace-access";

/**
 * /:workspaceSegment/members — workspace access-control console. Seam only;
 * `MembersView` and its tree are REUSED by import, already client-side over
 * `apiRequest`, which transports over the Electron IPC bridge unchanged.
 *
 * Invites, role changes and join-request decisions are `sessionOnly`
 * server-side; the SPA is a session caller (main attaches the user's session,
 * not an MCP bearer), so they work as on web.
 *
 * `useWorkspaceAccess`'s resolve query shares a cache entry with the shell's
 * `useWorkspaceRoute` — workspace costs no extra request.
 */
export default function MembersPage() {
  const { access, isPending, error, refetch } = useWorkspaceAccess();

  if (error) return <PageError error={error} onRetry={refetch} />;
  if (isPending || !access) return <PageLoading label="Loading members" variant="two-pane" />;

  return (
    <MembersView
      workspaceSlug={access.workspaceSlug}
      workspaceId={access.workspaceId}
      currentUserId={access.currentUserId}
      myRole={access.role}
    />
  );
}

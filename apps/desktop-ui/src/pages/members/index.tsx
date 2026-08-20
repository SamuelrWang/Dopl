import { MembersV2View } from "@/features/members/components/members-v2/members-v2-view";
import { PageError, PageLoading } from "#/components/page-states";
import { useWorkspaceAccess } from "#/hooks/use-workspace-access";

/**
 * /:workspaceSegment/members — workspace access-control console. Seam only;
 * `MembersV2View` and its tree are REUSED by import, already client-side over
 * `apiRequest`, which transports over the Electron IPC bridge unchanged.
 *
 * Invites, role changes and join-request decisions are `sessionOnly`
 * server-side; the SPA is a session caller (main attaches the user's session,
 * not an MCP bearer), so they work as on web.
 */
export default function MembersPage() {
  const { access, isPending, error, refetch } = useWorkspaceAccess();

  if (error) return <PageError error={error} onRetry={refetch} />;
  if (isPending || !access) return <PageLoading label="Loading members" variant="two-pane" />;

  return (
    <MembersV2View
      workspaceSlug={access.workspaceSlug}
      workspaceId={access.workspaceId}
      currentUserId={access.currentUserId}
      myRole={access.role}
    />
  );
}

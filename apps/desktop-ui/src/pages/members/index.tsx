import { MembersV2View } from "@/features/members/components/members-v2/members-v2-view";
import { PageError } from "#/components/page-states";
import { useWorkspaceAccess } from "#/hooks/use-workspace-access";
import { MembersPageSkeleton } from "./members-skeleton";

/**
 * /:workspaceSegment/members — a seam over the shared `MembersV2View`. Invites and role changes
 * are `sessionOnly` server-side, and the SPA is a session caller, so they work as on web. The
 * page's own skeleton stands at both gates (the workspace resolve, then the roster read).
 */
export default function MembersPage() {
  const { access, isPending, error, refetch } = useWorkspaceAccess();

  if (error) return <PageError error={error} onRetry={refetch} />;
  if (isPending || !access) return <MembersPageSkeleton label="Loading members" />;

  return (
    <MembersV2View
      workspaceSlug={access.workspaceSlug}
      workspaceId={access.workspaceId}
      currentUserId={access.currentUserId}
      myRole={access.role}
      // A slot: the shared view cannot import this package.
      loadingSkeleton={<MembersPageSkeleton label="Loading members" />}
    />
  );
}

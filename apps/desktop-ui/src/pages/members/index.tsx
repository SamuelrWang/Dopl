import { MembersView } from "@/features/members/components/members-view";
import { PageError, PageLoading } from "#/components/page-states";
import { useWorkspaceAccess } from "#/hooks/use-workspace-access";

/**
 * /:workspaceSegment/members — the workspace access-control console.
 * Port of `src/app/[workspaceSlug]/(app)/members/page.tsx`
 * (docs/migration-research/web-pages.md §13).
 *
 * The RSC fetched nothing: it resolved the workspace + the caller's
 * membership and handed `MembersView` four props. Everything below that —
 * roster, invitations, teams, the access matrix, join requests, and every
 * mutation in `teams-client.ts` — was already client-side over `apiRequest`,
 * which transports over the Electron IPC bridge here with no changes. So this
 * file is only the seam that replaces the two server calls, and `MembersView`
 * and its whole tree are REUSED by import.
 *
 * Invites, role changes and join-request decisions are `sessionOnly`
 * server-side; the SPA is a session caller (the main process attaches the
 * user's session, not an MCP bearer), so they work as they do on the web.
 *
 * `useWorkspaceAccess` is the same hook the skills port uses, and its resolve
 * query shares a cache entry with the shell's `useWorkspaceRoute` — the
 * workspace costs no extra request.
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

import { MembersV2View } from "@/features/members/components/members-v2/members-v2-view";
import { PageError } from "#/components/page-states";
import { useWorkspaceAccess } from "#/hooks/use-workspace-access";
import { MembersPageSkeleton } from "./members-skeleton";

/**
 * /:workspaceSegment/members — workspace access-control console. Seam only;
 * `MembersV2View` and its tree are REUSED by import, already client-side over
 * `apiRequest`, which transports over the Electron IPC bridge unchanged.
 *
 * Invites, role changes and join-request decisions are `sessionOnly`
 * server-side; the SPA is a session caller (main attaches the user's session,
 * not an MCP bearer), so they work as on web.
 *
 * ⚠ THE LOADING STATE IS THIS PAGE'S OWN SHAPE (`./members-skeleton.tsx`) — the
 * `minmax(380px,42fr)` roster over the dark-headed detail pane. It was
 * `PageLoading variant="two-pane"`, i.e. a 372px avatar list over a centred
 * document column, which is a two-pane surface but not THIS one.
 *
 * ⚠ AND IT IS THE SAME SHAPE AT **BOTH** GATES — the workspace resolve here,
 * then `MembersV2View`'s own roster read. `loadingSkeleton` hands the view this
 * shape so the two frames are one steady surface; a host that passes nothing
 * keeps the shared `TwoPaneListSkeleton`, so the web tree is unchanged.
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
      // ⚠ A SLOT, NOT AN IMPORT ON THE OTHER SIDE — the view is in the shared
      // tree and cannot reach into this package. Same idiom as `RouterLink` on
      // `pages/channels/index.tsx` and `loadingSkeleton` on `pages/agents`.
      loadingSkeleton={<MembersPageSkeleton label="Loading members" />}
    />
  );
}

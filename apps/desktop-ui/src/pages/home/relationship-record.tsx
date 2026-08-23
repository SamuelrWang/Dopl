import { UserRoundX } from "lucide-react";
import { StandaloneChannelSurface } from "@/features/channels/components/channels-v2/channel-surface-standalone";
import { useChannels } from "@/features/channels/hooks/use-channels";
import { EmptyState } from "@/shared/ui/empty-state";
import { DetailPaneSkeleton, TranscriptSkeleton } from "@/shared/ui/skeleton";
import { PageError } from "#/components/page-states";
import type { HomeRelationship } from "@/features/home/types";
import { PersonInfoTab } from "./person-info-tab";

/**
 * A relationship's RECORD — the whole channels-v2 surface, pinned to the one
 * direct channel inside the link container.
 *
 * ⚠ THE CHANNEL ROW COMES FROM THE CHANNELS FEATURE'S OWN READ, not a new
 * transport: `useChannels` sends `X-Workspace-Id` from its `workspaceId` arg,
 * so addressing a link container is the same call the workspace page makes. The
 * surface needs the resolved row, never an id (`channel-surface.tsx`).
 *
 * ⚠ ONE WORKSPACE WATCHED AT A TIME. The surface subscribes realtime per
 * `workspaceId` through the shared registry, and the desktop bridge watches a
 * single workspace last-writer-wins — switching relationships re-watches, which
 * is the accepted behaviour here, not a bug to route around.
 */
export function RelationshipRecord({
  relationship,
  currentUserId,
  onDeleted,
}: {
  relationship: HomeRelationship;
  currentUserId: string;
  /** The container's channel was deleted from Settings — drop the selection. */
  onDeleted: () => void;
}) {
  const { channels, loading, error, refetch } = useChannels(
    relationship.workspaceId,
    false
  );

  if (loading) {
    return (
      <DetailPaneSkeleton>
        <TranscriptSkeleton className="px-5 py-4" />
      </DetailPaneSkeleton>
    );
  }
  if (error) {
    return <PageError error={new Error(error)} onRetry={() => refetch()} />;
  }

  const channel = channels.find((row) => row.id === relationship.channelId);
  if (!channel) {
    return (
      <EmptyState
        icon={UserRoundX}
        title="This relationship is no longer available"
        description="Its channel was removed."
      />
    );
  }

  return (
    <StandaloneChannelSurface
      workspaceId={relationship.workspaceId}
      workspaceSlug={relationship.workspaceSegment}
      channel={channel}
      currentUserId={currentUserId}
      onDeleted={onDeleted}
      slots={{ infoTab: <PersonInfoTab relationship={relationship} /> }}
      // A link container holds exactly two people, forever — "add members"
      // names an operation that cannot happen here.
      capabilities={{ memberManagement: false }}
    />
  );
}

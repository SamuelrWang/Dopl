import { UserRoundX } from "lucide-react";
import { StandaloneChannelSurface } from "@/features/channels/components/channels-v2/channel-surface-standalone";
import { useChannels } from "@/features/channels/hooks/use-channels";
import { EmptyState } from "@/shared/ui/empty-state";
import { DetailPaneSkeleton, TranscriptSkeleton } from "@/shared/ui/skeleton";
import { PageError } from "#/components/page-states";
import type { HomeChannel } from "@/features/home/types";
import { PersonInfoTab } from "./person-info-tab";

/**
 * A home channel's RECORD — the whole channels-v2 surface, pinned to the one
 * channel inside the link container.
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
  homeChannel,
  currentUserId,
  onDeleted,
}: {
  homeChannel: HomeChannel;
  currentUserId: string;
  /** The container's channel was deleted from Settings — drop the selection. */
  onDeleted: () => void;
}) {
  const { channels, loading, error, refetch } = useChannels(
    homeChannel.workspaceId,
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

  const channel = channels.find((row) => row.id === homeChannel.channelId);
  if (!channel) {
    return (
      <EmptyState
        icon={UserRoundX}
        title="This channel is no longer available"
        description="It was removed."
      />
    );
  }

  return (
    <StandaloneChannelSurface
      workspaceId={homeChannel.workspaceId}
      workspaceSlug={homeChannel.workspaceSegment}
      channel={channel}
      currentUserId={currentUserId}
      onDeleted={onDeleted}
      // ⚠ A RENDER FUNCTION SINCE 2026-08-25, and the argument is the point:
      // the person card became write-bearing when the Main-info rows became
      // removable, and INVARIANTS §7/§8 allow ONE `useRefetchGate` per live
      // surface. The surface hands its own down rather than the slot minting a
      // second one that coordinates with nothing.
      slots={{
        infoTab: ({ gate }) => (
          <PersonInfoTab homeChannel={homeChannel} channel={channel} gate={gate} />
        ),
      }}
      // A link container holds at most two people — the peer arrives by
      // claiming its link, never through the channel roster, so "add members"
      // names an operation that cannot happen here.
      capabilities={{ memberManagement: false }}
    />
  );
}

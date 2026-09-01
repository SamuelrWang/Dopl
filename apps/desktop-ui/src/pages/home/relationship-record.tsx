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
  initialThreadId = null,
  onDeleted,
}: {
  homeChannel: HomeChannel;
  currentUserId: string;
  /**
   * A thread to raise on MOUNT — how an Overview activity row lands
   * (`use-activity-jump.ts`, 2026-09-01). ⚠ **INITIAL, NOT CONTROLLED**: the
   * surface seeds its own selection from it once
   * (`use-channels-v2-selection.ts`), so a later value only takes effect on a
   * remount — which is exactly what happens here, because /home keys this pane
   * by the row and swaps the whole element when the face changes.
   */
  initialThreadId?: string | null;
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
      initialThreadId={initialThreadId}
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
      // ⚠ `memberManagement: false` IS NOT A HEADCOUNT — a container takes MORE
      // THAN TWO people since 2026-08-26. Every member arrives by claiming a
      // link BOUND to this container, never through the channel roster (§4A:
      // every workspace-level add answers `LINK_CONTAINER_CLOSED`), so "add
      // members" names an operation that cannot happen here at ANY size. The
      // act that CAN happen lives on the Info tab as Add person.
      // ⚠ NO `knowledge` CAPABILITY — THE FIFTH INFO TAB IS OFF ON THIS SURFACE
      // (Samuel, 2026-08-27; F-340). It passed `knowledge: true` from M4 to show
      // the operator exactly what the guest sees, and that cost the info column a
      // FIFTH tab on a width budget measured for four: the trackless `lg`
      // `SegmentedControl` leaves ~55px spare at 380px and "Knowledge" wants ~90,
      // so the row tightened and then SCROLLED.
      // ⚠ THE OPERATOR LOSES NOTHING HERE, which is the whole reason this is the
      // side that gives way. The /home Knowledge FACE (`knowledge-panels.tsx`,
      // the header's own segmented control) is a full surface over the same
      // bases; the tab was the smaller of two views one click apart.
      // ⚠ THE GUEST LANE KEEPS ITS TAB (`src/app/c/[workspaceId]/guest-channel.tsx`)
      // and that asymmetry is deliberate, not an oversight: the tab is the guest's
      // ONLY way to read a base granted into this channel. Removing it there would
      // have taken the capability away rather than the duplicate view.
      // 🔒 `peerNamedHeader: false` — THE PANE'S HEADER IS THE CHANNEL'S NAME
      // (Samuel, 2026-09-01). The list row and the Info tab were fixed at
      // `home-rows.ts › channelTitle`; this header reads the OTHER counterpart
      // derivation (`channel-display.ts › channelDisplayName`), so a container
      // whose channel still carries `is_direct = true` — every one minted before
      // the channel-first inversion — would have named the peer at the top of
      // the pane while the row and the card beside it named the channel. Real
      // DMs on the workspace page are untouched; see the capability's docblock.
      capabilities={{ memberManagement: false, peerNamedHeader: false }}
    />
  );
}

import { UserRoundX } from "lucide-react";
import { StandaloneChannelSurface } from "@/features/channels/components/channel-surface-standalone";
import { useChannels } from "@/features/channels/hooks/use-channels";
import { EmptyState } from "@/shared/ui/empty-state";
import { PageError } from "#/components/page-states";
import { EMPTY_ROLE, type HomeChannel } from "@/features/home/types";
import { ChannelRecordSkeleton } from "./channel-record-skeleton";
import { PersonInfoTab } from "./person-info-tab";

/**
 * A home channel's RECORD — the whole channels surface, pinned to the one
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
  initialSeq = null,
  onDeleted,
}: {
  homeChannel: HomeChannel;
  currentUserId: string;
  /**
   * A thread to raise on MOUNT — how an Overview activity row lands
   * (`use-activity-jump.ts`, 2026-09-01). ⚠ **INITIAL, NOT CONTROLLED**: the
   * surface seeds its own selection from it once
   * (`use-channels-selection.ts`), so a later value only takes effect on a
   * remount — which is exactly what happens here, because /home keys this pane
   * by the row and swaps the whole element when the face changes.
   */
  initialThreadId?: string | null;
  /**
   * A message to land the transcript ON, by `channel_messages.seq` — how a
   * SEARCH hit on a message lands here (F-714, 2026-09-17). ⚠ INITIAL for
   * `initialThreadId`'s reason, and consumed once: `use-message-jump.ts` fires
   * the surface's own nonced scroll signal as soon as the transcript has rows,
   * and a seq outside the loaded page reaches the "older than the loaded
   * history" notice rather than scrolling nowhere in silence.
   */
  initialSeq?: number | null;
  /** The container's channel was deleted from Settings — drop the selection. */
  onDeleted: () => void;
}) {
  const { channels, loading, error, refetch } = useChannels(
    homeChannel.workspaceId,
    false
  );

  // ⚠ THE PANE'S OWN SHAPE, NOT THE KIT'S TWO GENERIC GHOSTS (Samuel,
  // 2026-09-13: *"this is the skeleton for the channel, it doesn't look accurate
  // at all"*). This gate rendered `DetailPaneSkeleton` — a 52px strip with one bar
  // and a square — around `TranscriptSkeleton`'s ALTERNATING bubbles, on a bare
  // pane: no composer, no divider and no info column, though that column is OPEN
  // at mount here. `channel-record-skeleton.tsx` mirrors what resolves into this
  // box, class expression for class expression (INVARIANTS §1A).
  if (loading) return <ChannelRecordSkeleton />;
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
      // 🔒 **THE CALLER'S REAL ROLE IN THIS CONTAINER (2026-09-17, F-343).** The
      // surface defaults this to `"member"` for a host that does not know, and
      // /home was that host — so the manage half of Settings and the header's
      // click-to-edit (`surface-info-panel.tsx › headerEdit.canEdit`, the mirror
      // of `service-shared.ts › canManageChannel`) were answered by a CONSTANT
      // rather than by this reader's membership. A guest peer and the container's
      // owner got the same picture; the server gave them different answers.
      // ⚠ **IT NARROWS AND WIDENS, AND BOTH ARE THE FIX.** A legacy unbound claim
      // seats its claimer at workspace `admin` (`repository-containers.ts ›
      // insertLinkContainer`), who the server WOULD let rename this channel and
      // who the `"member"` default was hiding the control from.
      // ⚠ §8 STALE-CACHE, SPELLED INLINE: a payload cached by the previous bundle
      // carries no `role` key, and `EMPTY_ROLE` (rank 0) renders display-only for
      // one paint rather than claiming a permission nobody read.
      role={homeChannel.role ?? EMPTY_ROLE}
      initialThreadId={initialThreadId}
      initialSeq={initialSeq}
      onDeleted={onDeleted}
      // ⚠ A RENDER FUNCTION SINCE 2026-08-25, and the argument is the point:
      // the person card became write-bearing when the Main-info rows became
      // removable, and INVARIANTS §7/§8 allow ONE `useRefetchGate` per live
      // surface. The surface hands its own down rather than the slot minting a
      // second one that coordinates with nothing.
      slots={{
        // ⚠ `mentions` RIDES WITH THE GATE (2026-09-15): the surface has already
        // read this channel's Tags inbox, scoped to THIS home container, and the
        // tab renders the same disclosure the workspace page does. Before this it
        // was fetched and dropped — see `ChannelInfoTabContext.mentions`.
        // ⚠ `headerEdit` RIDES WITH THEM TOO (2026-09-17, Samuel: *"I want to be
        // able to click where the name and description are"*) — the surface has
        // ALREADY minted the write and mirrored `canManageChannel` for the tab it
        // is not rendering, so the /home card takes that bundle rather than a
        // second hook on a second gate.
        infoTab: ({ gate, mentions, headerEdit }) => (
          <PersonInfoTab
            homeChannel={homeChannel}
            channel={channel}
            gate={gate}
            mentions={mentions}
            headerEdit={headerEdit}
          />
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
      // 🔒 `artifacts: true` — THE THREADS PANEL TOGGLES TO AN ARTIFACTS FACE HERE,
      // AND ONLY HERE (Samuel, 2026-09-16, under his standing home-space ruling for
      // a new surface). ⚠ IT IS NOT THE FIFTH TAB THE NOTE ABOVE REFUSES: the face
      // shares the Threads slot and its heading, so the row is still four options on
      // the same width budget. ⚠ The workspace channel page and the guest lane pass
      // nothing and are unchanged — the face's reads mount with the face, so a host
      // that never offers it never asks for a card.
      capabilities={{
        memberManagement: false,
        peerNamedHeader: false,
        artifacts: true,
      }}
    />
  );
}

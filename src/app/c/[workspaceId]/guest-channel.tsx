"use client";

/**
 * THE GUEST'S WHOLE APPLICATION — one channel, full viewport, no rail, no
 * sidebar, no workspace surfaces. Mirrors the desktop's
 * `apps/desktop-ui/src/pages/home/relationship-record.tsx`: the server hands
 * down a `HomeChannel`, the channels feature's OWN read resolves the `Channel`
 * row it names, and `StandaloneChannelSurface` is the rest.
 *
 * ⚠ `next/dynamic` WITH `ssr: false`, not a plain import. The surface tree is
 * client-only in fact (bridge feature-detection, IndexedDB-backed query cache,
 * a realtime subscription); saying so at the mount is what keeps a server pass
 * from ever running code that assumes a browser.
 *
 * ⚠ BOTH CAPABILITY FLAGS ARE OFF, AND THE SECOND ONE IS THE GUEST'S OWN STORY
 * (rulings R2/R3, 2026-08-25). `memberManagement: false` is the container's
 * fixed two-person roster, the same answer the desktop's home surface gives.
 * `selfManagement: false` is this lane alone: a guest runs NO agent, so the
 * tool profile would govern a session that does not exist, and "Leave channel"
 * is a one-way exit from their only Dopl surface — the link that admitted them
 * was revoked at claim, so there is no way back in. ONE flag covers both
 * because it is one story; see `channel-surface.tsx › ChannelSurfaceCapabilities`.
 *
 * ⚠ NO `role` PROP, DELIBERATELY (ruling R4, 2026-08-25). The claimer really is
 * a workspace `admin` (§4A), so the SERVER would permit rename/archive and
 * minting a further link; omitting `role` takes the surface's least-privileged
 * default and narrows the UI. It HIDES, it does not deny — accepted for MVP
 * because a link container holds two people who chose each other and the
 * operator can delete it. Do not "fix" this by passing the real role through.
 *
 * ⚠ THIS COMPONENT OWNS ITS OWN HEIGHT AND ITS OWN PAINT (ruling R5). `/c` is
 * deliberately NOT in `layout-shell.tsx › NON_WORKSPACE_ROOTS` — that branch
 * renders a centred container, which is the wrong shape for a full-viewport
 * surface — so the shell renders children bare AND paints the body with the app
 * rail's `#2c3640`. `h-[100dvh]` supplies the bounded flex parent every pane
 * below measures against (nothing in the Next tree does), and `bg-bg-elevated`
 * is the panel-surface token that overrides the rail colour. `dvh`, not `vh`:
 * a mobile browser's collapsing URL bar otherwise crops the composer.
 */

import dynamic from "next/dynamic";
import { MessageSquareOff, TriangleAlert } from "lucide-react";
import { useCallback, useState } from "react";
import { useChannels } from "@/features/channels/hooks/use-channels";
import { EmptyState } from "@/shared/ui/empty-state";
import { DetailPaneSkeleton, TranscriptSkeleton } from "@/shared/ui/skeleton";
import type { HomeChannel } from "@/features/home/types";

const StandaloneChannelSurface = dynamic(
  () =>
    import(
      "@/features/channels/components/channels-v2/channel-surface-standalone"
    ).then((mod) => mod.StandaloneChannelSurface),
  { ssr: false }
);

export function GuestChannel({
  homeChannel,
  currentUserId,
}: {
  homeChannel: HomeChannel;
  currentUserId: string;
}) {
  /**
   * ⚠ THE TERMINAL STATE IS LATCHED, because the delete is what makes the read
   * that would prove it impossible: after `onDeleted` the channel is gone from
   * the server, so a refetch answers "no such row" and the mount would fall
   * into the same ending by a slower, flickering route.
   */
  const [deleted, setDeleted] = useState(false);
  const { channels, loading, error, refetch } = useChannels(
    homeChannel.workspaceId,
    false
  );
  const onDeleted = useCallback(() => setDeleted(true), []);

  const channel = channels.find((row) => row.id === homeChannel.channelId);

  return (
    <div className="flex h-[100dvh] bg-bg-elevated">
      {deleted ? (
        <ChannelGone />
      ) : loading ? (
        // The reference implementation's pair (`relationship-record.tsx`),
        // announced. ⚠ THE WRAPPER IS SEMANTICS, NOT A FORKED RECIPE: only the
        // PAGE-level composites in `skeleton.tsx` carry `role="status"` and its
        // `sr-only` label, and this one is page-level — the shimmer is the
        // guest's entire viewport, and `aria-hidden` shapes alone are silence.
        <div
          className="flex min-w-0 flex-1"
          role="status"
          aria-busy="true"
          aria-live="polite"
        >
          <span className="sr-only">Loading channel</span>
          <DetailPaneSkeleton>
            <TranscriptSkeleton className="px-5 py-4" />
          </DetailPaneSkeleton>
        </div>
      ) : error ? (
        // ⚠ NOT the gone state. "We could not load it" and "it does not exist"
        // are different sentences, and only one of them is worth retrying.
        <EmptyState
          icon={TriangleAlert}
          title="This channel would not load"
          description="Something went wrong on the way to the conversation."
        >
          <button
            type="button"
            onClick={() => void refetch()}
            className="btn-light mt-1 cursor-pointer rounded-full px-3.5 py-1.5 text-small font-medium text-text-secondary"
          >
            Try again
          </button>
        </EmptyState>
      ) : !channel ? (
        // The container is still the caller's — the server proved that — but
        // the channel inside it is gone. Same ending as `onDeleted`.
        <ChannelGone />
      ) : (
        <StandaloneChannelSurface
          workspaceId={homeChannel.workspaceId}
          workspaceSlug={homeChannel.workspaceSegment}
          channel={channel}
          currentUserId={currentUserId}
          capabilities={{ memberManagement: false, selfManagement: false }}
          onDeleted={onDeleted}
        />
      )}
    </div>
  );
}

/**
 * ⚠ AN ENDING, NOT A DETOUR. A guest arrived here from a single link and has no
 * other Dopl surface to be sent to — a "back to your workspace" button would
 * name a place they have never been. So the panel offers no navigation at all.
 */
function ChannelGone() {
  return (
    <EmptyState
      icon={MessageSquareOff}
      title="This channel no longer exists"
      description="It was deleted. There is nothing left to open here."
    />
  );
}

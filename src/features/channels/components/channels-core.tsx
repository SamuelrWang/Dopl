"use client";

import { useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import type { LinkLike } from "@/shared/ui/link-like";
import { meetsMinRole, type Role } from "@/features/workspaces/types";
import { useChannels } from "../hooks/use-channels";
import { channelKeys } from "../client/query-keys";
import { ChannelsSkeleton } from "./channels-skeleton";
import { ChannelsOnboardingCore } from "./channels-onboarding-core";
import { ChannelsOverlays } from "./overlays";
import { ChannelsSidebar } from "./sidebar";
import { ChannelSurface } from "./channel-surface";
import { useChannelSurfaceData } from "./channel-surface-data";
import type { Channel } from "../types";
import type { SearchItem } from "@/features/search/contracts";
import { splitChannels } from "./view-model";
import { useChannelsSelection } from "./use-channels-selection";

export interface ChannelsCoreProps {
  workspaceId: string;
  workspaceSlug: string;
  currentUserId: string;
  role: Role;
  /** Router-agnostic link; its one consumer is the first-run explainer (`channels-onboarding-core.tsx`). */
  Link: LinkLike;
  /** Initial selection a caller named (the desktop `/channels/:channelId` param); this tree is router-free. */
  initialChannelId?: string | null;
  /** Initial thread (`?thread=`) inside `initialChannelId` — a selection, not a route. */
  initialThreadId?: string | null;
  /** Message seq the route named (`?seq=`, from a mention notification), scoped to `initialChannelId`. */
  initialSeq?: number | null;
  /** Where search rows for other pages go; the host navigates, and absent means those rows do nothing. */
  onNavigatePath?: (path: string) => void;
}

/**
 * Channels root: channel tree, `channel-surface.tsx` and overlays, over the real channels reads. Next-free so the
 * desktop SPA can bundle it. The refetch coordinator (`useChannelSurfaceData`) mounts here, above the channel
 * branch, so the channel list keeps hearing the doorbell with no channel open (INVARIANTS §7).
 */
export function ChannelsCore({
  workspaceId,
  workspaceSlug,
  currentUserId,
  role,
  Link,
  initialChannelId = null,
  initialThreadId = null,
  initialSeq = null,
  onNavigatePath,
}: ChannelsCoreProps) {
  const sel = useChannelsSelection({ initialChannelId, initialThreadId });
  // Keyed to its channel: a bare seq would re-fire into whatever channel opens next.
  const [searchSeq, setSearchSeq] = useState<{ channelId: string; seq: number } | null>(null);
  // Same keying; a search row wins over the route because it is the later act.
  const routedSeq =
    initialSeq !== null && initialChannelId
      ? { channelId: initialChannelId, seq: initialSeq }
      : null;
  const jumpSeq = searchSeq ?? routedSeq;
  const queryClient = useQueryClient();

  const { channels, loading, refetch: refetchChannels } = useChannels(workspaceId);

  // Conversation rows use this page's own selection; other kinds navigate via the host.
  // Only a `messages` row carries a seq — every other kind clears it.
  const openSearchHit = (item: SearchItem) => {
    if (item.kind === "knowledge") return onNavigatePath?.(`/${workspaceSlug}/knowledge`);
    if (item.kind === "agentIdentities") return onNavigatePath?.(`/${workspaceSlug}/identities`);
    if (item.kind === "members") return onNavigatePath?.(`/${workspaceSlug}/members`);
    if (item.kind === "skills") return onNavigatePath?.(`/${workspaceSlug}/skills`);
    if (item.kind === "chats") return onNavigatePath?.(`/${workspaceSlug}/chats`);
    if (item.channelId) sel.selectChannel(item.channelId);
    if (item.threadId) sel.openThread(item.threadId);
    setSearchSeq(
      item.kind === "messages" && item.channelId && item.seq != null
        ? { channelId: item.channelId, seq: item.seq }
        : null
    );
  };

  // A manual pick is the reader asking for a channel, not for a seq inside it.
  const selectChannel = (id: string) => {
    setSearchSeq(null);
    sel.selectChannel(id);
  };

  // An explicit pick that still exists wins, else the first row, so a deleted channel cannot strand the pane.
  const effectiveId = useMemo(() => {
    const picked = sel.selectedId;
    if (picked && channels.some((c) => c.id === picked)) return picked;
    return channels[0]?.id ?? null;
  }, [sel.selectedId, channels]);
  const channel = channels.find((c) => c.id === effectiveId) ?? null;

  // The channel list rides the surface's doorbell — one `useRefetchGate` per live surface (INVARIANTS §7).
  // Invalidate the prefix: `refetch()` would revalidate only the mounted key variant.
  const data = useChannelSurfaceData({
    workspaceId,
    workspaceSlug,
    channel,
    currentUserId,
    openThreadId: sel.requestedThreadId,
    onDoorbell: () => {
      void queryClient.invalidateQueries({ queryKey: channelKeys.list().all });
    },
  });

  const onCreated = (created: Channel) => {
    sel.selectChannel(created.id);
    void refetchChannels();
  };

  if (loading && channels.length === 0) return <ChannelsSkeleton />;

  const { direct, rooms } = splitChannels(channels);
  const canCreate = meetsMinRole(role, "member");

  return (
    // `relative` is the agent view's containing block; `.page-float` clips it to the card's radius.
    // `data-frame-skin`: this page is one of the account palette skin's three hosts (docs/DESIGN-SYSTEM.md).
    <div className="page-float relative flex antialiased" data-frame-skin>
      <ChannelsSidebar
        workspaceId={workspaceId}
        rooms={rooms}
        direct={direct}
        threads={data.treeThreads}
        members={data.members}
        currentUserId={currentUserId}
        selectedChannelId={channel?.id ?? null}
        openThreadId={data.openThread?.id ?? null}
        onSelectChannel={selectChannel}
        onOpenThread={sel.openThread}
        canCreate={canCreate}
        onCreateChannel={() => sel.setCreateOpen(true)}
        onCreateDirect={() => sel.setDirectOpen(true)}
        onSearchNavigate={openSearchHit}
      />

      {channel ? (
        <ChannelSurface
          workspaceId={workspaceId}
          workspaceSlug={workspaceSlug}
          channel={channel}
          currentUserId={currentUserId}
          role={role}
          data={data}
          selection={sel}
          initialSeq={jumpSeq?.channelId === channel?.id ? jumpSeq.seq : null}
          onRosterChanged={refetchChannels}
          capabilities={{ artifacts: true }}
        />
      ) : (
        // No channels yet: the first-run explainer.
        <ChannelsOnboardingCore
          workspaceSlug={workspaceSlug}
          canCreate={canCreate}
          onCreate={() => sel.setCreateOpen(true)}
          Link={Link}
        />
      )}

      <ChannelsOverlays
        data={data}
        openAgent={sel.openAgent}
        currentUserId={currentUserId}
        workspaceId={workspaceId}
        workspaceSlug={workspaceSlug}
        createOpen={sel.createOpen}
        directOpen={sel.directOpen}
        onCloseAgent={() => sel.setOpenAgent(null)}
        onCreateOpenChange={sel.setCreateOpen}
        onDirectOpenChange={sel.setDirectOpen}
        onCreated={onCreated}
      />
    </div>
  );
}

"use client";

/**
 * `info-panel.tsx` wired to a channel surface: facts, writes, the Settings slot and mention actions.
 * Fetches nothing — every read is the host's `ChannelSurfaceData` (INVARIANTS §7).
 */

import { useState } from "react";
import type { Role } from "@/features/workspaces/types";
import { cn } from "@/shared/lib/utils";
import { PAGE_ACTION_BTN } from "@/shared/ui/page-action-button";
import { InviteDialog } from "./invite-dialog";
import { useChannelHeaderWrite } from "../hooks/use-channel-header-writes";
import { useChannelInfoCardWrite } from "../hooks/use-channel-info-card-writes";
import { ChannelsSettingsSlot } from "./settings-slot";
import { canManageChannelHere } from "../lib/channel-manage-gate";
import { ChannelsInfoPanel, type TabKey } from "./info-panel";
import type { ChannelSurfaceData } from "./channel-surface-data";
import type { ChannelsSelection } from "./use-channels-selection";
import type { ChannelWebView } from "./use-channel-web-view";
import type {
  ChannelSurfaceCapabilities,
  ChannelSurfaceSlots,
} from "./channel-surface-contract";
import type { Channel, ChannelMention } from "../types";
import { launchAllowedInView } from "./launch-view-gate";

export function SurfaceInfoPanel({
  channel,
  channelName,
  workspaceId,
  workspaceSlug,
  currentUserId,
  role,
  data,
  selection: sel,
  slots,
  capabilities,
  onDeselect,
  onRosterChanged,
  webView,
  fullTab,
}: {
  channel: Channel;
  /** Derived by the surface (`peerNamedHeader`). */
  channelName: string;
  workspaceId: string;
  workspaceSlug: string;
  currentUserId: string;
  role: Role;
  data: ChannelSurfaceData;
  selection: ChannelsSelection;
  slots?: ChannelSurfaceSlots;
  capabilities?: ChannelSurfaceCapabilities;
  onDeselect?: () => void;
  onRosterChanged?: () => void;
  /** Present on the web's single column. */
  webView?: ChannelWebView;
  /** One tab as the main area, or absent for the desktop's tab column. */
  fullTab?: TabKey;
}) {
  const { members, threads, mentions, agentSessions, agentsPanel, index, openThread, gate } =
    data;

  // Every write shares the surface's one `gate` so realtime can't repaint the old value mid-write (INVARIANTS §7/§8).
  const headerWrite = useChannelHeaderWrite({
    channelId: channel.id,
    workspaceId,
    gate,
  });
  // The derived-name half is `info-tab-card.tsx › headerEditable`.
  const canManage = canManageChannelHere(channel, role);
  const headerEdit = {
    canEdit: canManage,
    onSaveName: headerWrite.saveName,
    onSaveTopic: headerWrite.saveTopic,
    busy: headerWrite.pending,
  };
  // Membership-gated, not manage-gated (`service-writes-channel.ts › updateChannel`), so no `canEdit`.
  const infoCardWrite = useChannelInfoCardWrite({
    channelId: channel.id,
    workspaceId,
    gate,
  });

  // Absent without `memberManagement` (link containers refuse adds, §4A); hidden, not disabled (INVARIANTS §5).
  const canAddMembers = capabilities?.memberManagement !== false && canManage;
  const [inviteOpen, setInviteOpen] = useState(false);

  // Single column: opening a transcript also switches the face. No-op on desktop.
  const showChannel = () => webView?.setView("channel");

  // Optimistic mark-read, then jump (the scroll signal runs post-render).
  const openMention = (mention: ChannelMention) => {
    if (!mention.read) {
      data.markRead.mutate({
        channelId: channel.id,
        messageIds: [mention.messageId],
      });
    }
    sel.jumpToMessage(mention.threadId, mention.messageId);
    showChannel();
  };

  // Sends the displayed unread ids, never an "all" flag: the list is bounded (INVARIANTS §9).
  const markAllMentionsRead = () => {
    const unread = mentions.filter((m) => !m.read).map((m) => m.messageId);
    if (unread.length === 0) return;
    data.markRead.mutate({ channelId: channel.id, messageIds: unread });
  };

  return (
    <ChannelsInfoPanel
      channel={channel}
      channelName={channelName}
      activityBins={data.activityBins}
      activityLoading={data.activityLoading}
      members={members}
      threads={threads}
      threadsTruncated={data.threadsTruncated}
      threadsLoading={data.threadsLoading}
      index={index}
      openThread={openThread}
      fullTab={fullTab}
      onOpenThread={(id) => {
        sel.openThread(id);
        showChannel();
      }}
      onNewThread={() => {
        sel.requestNewThread();
        showChannel();
      }}
      agentSessions={agentSessions}
      peerSessions={agentsPanel.peerSessions}
      canLaunchAgent={launchAllowedInView(agentsPanel.canLaunch, openThread, currentUserId)}
      launchBusy={agentsPanel.launchBusy}
      launchError={agentsPanel.launchError}
      // Passed unwrapped (branded `LaunchAgentFn`): a narrower wrapper dropped agentId/runtime/colour (P6-01).
      onLaunchAgent={agentsPanel.launchAgent}
      onApproveIdentity={agentsPanel.approveIdentity}
      openAgent={sel.openAgent}
      onOpenAgent={sel.setOpenAgent}
      // Bumped by `use-channels-selection.ts › toggleAgent` when it closes the agent view.
      infoTabSignal={sel.infoTabSignal}
      mentions={mentions}
      mentionsTruncated={data.mentionsTruncated}
      mentionsLoading={data.mentionsLoading}
      onOpenMention={openMention}
      onMarkAllMentionsRead={markAllMentionsRead}
      artifacts={capabilities?.artifacts}
      headerEdit={headerEdit}
      infoCardEdit={{ onSave: infoCardWrite.save }}
      mentionsLayout={capabilities?.mentionsLayout}
      // Hosts without member management always include the reader, so the empty line would only flash falsely.
      rosterEmptyLine={capabilities?.memberManagement !== false}
      membersAction={
        canAddMembers ? (
          <>
            <button
              type="button"
              onClick={() => setInviteOpen(true)}
              // The recipe is face and scale only; spacing stays at the call site.
              className={cn(PAGE_ACTION_BTN, "ml-auto")}
            >
              Add member
            </button>
            {inviteOpen && (
              <InviteDialog
                workspaceId={workspaceId}
                workspaceSlug={workspaceSlug}
                channelId={channel.id}
                currentUserId={currentUserId}
                canManage
                open
                onOpenChange={setInviteOpen}
                onChanged={() => {
                  onRosterChanged?.();
                  data.refetchMembers();
                }}
              />
            )}
          </>
        ) : null
      }
      // Called, not passed: the extras render function receives this surface's gate.
      infoExtras={slots?.infoExtras?.({
        gate,
        headerEdit,
        members,
        refetchMembers: data.refetchMembers,
        index,
        activity: { bins: data.activityBins, loading: data.activityLoading },
        channelName,
        mentions: {
          mentions,
          truncated: data.mentionsTruncated,
          loading: data.mentionsLoading,
          index,
          onOpen: openMention,
          onMarkAllRead: markAllMentionsRead,
        },
      })}
      settings={
        <ChannelsSettingsSlot
          channel={channel}
          workspaceId={workspaceId}
          workspaceSlug={workspaceSlug}
          currentUserId={currentUserId}
          role={role}
          members={members}
          thread={openThread}
          agentSessions={agentSessions}
          gate={gate}
          memberManagement={capabilities?.memberManagement}
          selfManagement={capabilities?.selfManagement}
          onDeselect={() => {
            sel.selectChannel(null);
            onDeselect?.();
          }}
          // Fires only on thread delete; drops it from the scroll-back window (the cache is patched elsewhere).
          onExitThread={() => {
            if (openThread) data.dropThreadFromHistory(openThread.id);
            sel.openThread(null);
          }}
          onRosterChanged={() => {
            onRosterChanged?.();
            data.refetchMembers();
          }}
        />
      }
    />
  );
}

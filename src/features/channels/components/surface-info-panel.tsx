"use client";

/**
 * THE TAB COLUMN, WIRED TO A SURFACE — `info-panel.tsx` plus every fact it
 * needs, the Settings slot, and the two mention actions taken only from inside
 * it. Extracted from `channel-surface.tsx` at the 500-line cap (2026-09-04):
 * the surface owns WHICH panes it shows, this owns how each is wired.
 *
 * ⚠ Two widths from one definition (`fullTab`): absent is the desktop's 380px
 * column with its tab row, present is ONE face as the main area.
 * ⚠ It FETCHES NOTHING — every read is `ChannelSurfaceData`, mounted once by
 * the HOST (INVARIANTS §7).
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
  /** Already derived by the surface — `peerNamedHeader` decides it, not this file. */
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
  /** Present on the WEB's single column — see `showChannel` below. */
  webView?: ChannelWebView;
  /** ONE face as the main area, or absent for the desktop's tab column. */
  fullTab?: TabKey;
}) {
  const { members, threads, mentions, agentSessions, agentsPanel, index, openThread, gate } =
    data;

  /**
   * ⚠ THE SURFACE'S ONE `gate` (INVARIANTS §7/§8), like every write wired here:
   * a second coordinator would let the realtime doorbell repaint the old name
   * mid-write. No new endpoint — `PATCH /api/channels/[channelId]`.
   */
  const headerWrite = useChannelHeaderWrite({
    channelId: channel.id,
    workspaceId,
    gate,
  });
  /**
   * THE INFO TAB'S CLICK-TO-EDIT NAME + DESCRIPTION (Samuel, 2026-09-16).
   * ⚠ The DERIVED-NAME half is the card's (`info-tab-card.tsx ›
   * headerEditable`) — a fact about the ROW, not about the reader.
   */
  const canManage = canManageChannelHere(channel, role);
  const headerEdit = {
    canEdit: canManage,
    onSaveName: headerWrite.saveName,
    onSaveTopic: headerWrite.saveTopic,
    busy: headerWrite.pending,
  };
  /**
   * THE CURATED INFO CARD'S WRITE (Samuel's ruling R-19, 2026-09-17).
   * ⚠ MEMBERSHIP-gated, not MANAGE-gated (Samuel, 2026-08-25;
   * `service-writes.ts › updateChannel`): the card is content the room carries,
   * not part of its lifecycle — so there is no `canEdit` half to mirror here.
   */
  const infoCardWrite = useChannelInfoCardWrite({
    channelId: channel.id,
    workspaceId,
    gate,
  });

  /**
   * 🔒 ADD MEMBER, ON THE Members HEADING — F-721 RESOLVED (Samuel, 2026-09-17,
   * answering R-46's option (b) yes).
   * ⚠ It rides `memberManagement`, which is what makes it absent on /home and
   * the guest lane: a link container's roster cannot be added to this way at ANY
   * size (§4A — every workspace-level add answers `LINK_CONTAINER_CLOSED`), so
   * the control would name an operation that always fails.
   * ⚠ HIDDEN, NOT DISABLED (INVARIANTS §5), and the dialog is mounted only while
   * open — it opens two reads and the add/remove writes.
   */
  const canAddMembers = capabilities?.memberManagement !== false && canManage;
  const [inviteOpen, setInviteOpen] = useState(false);

  // ⚠ ON ONE COLUMN, OPENING A TRANSCRIPT HAS TO MOVE THE FACE TOO — a picked
  // thread, a jumped-to mention and a new-thread ask all land in the
  // CONVERSATION, which is a different face there and the pane next door on the
  // desktop. A no-op without `webView`, so every desktop mount is unchanged.
  const showChannel = () => webView?.setView("channel");

  // The Tags inbox's click: mark read, land the center pane on the right
  // transcript, then signal the scroll (the effect runs POST-render, so the
  // swapped transcript is in the DOM first). The mark-read is optimistic.
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

  // ⚠ MARK-ALL SENDS THE IDS IT IS DISPLAYING, never a flag. The list is bounded
  // and says when it clipped, so "all" can only honestly mean the page — naming
  // the ids makes that true by construction (INVARIANTS §9). Already-read rows are
  // filtered out, so a no-op click sends no request.
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
      // ⚠ CHANNEL VIEW LAUNCHES TOO (fixed 2026-09-08) — `launch-view-gate.ts ›
      // launchAllowedInView` carries the rule and its test; it used to require an
      // open thread, which left channel view with no launch control at all.
      canLaunchAgent={launchAllowedInView(agentsPanel.canLaunch, openThread, currentUserId)}
      launchBusy={agentsPanel.launchBusy}
      launchError={agentsPanel.launchError}
      // ⚠ THE PROMISE IS HANDED THROUGH, not voided (2026-08-22): the identity
      // picker AWAITS it to learn whether main asked for a first-use approval, and
      // a `void` wrapper would make every picker launch look like a dead bridge.
      onLaunchAgent={(id, identityId, overrides) =>
        agentsPanel.launchAgent(id, identityId, overrides)
      }
      onApproveIdentity={agentsPanel.approveIdentity}
      openAgent={sel.openAgent}
      onOpenAgent={sel.setOpenAgent}
      // ⚠ THE PILL'S SECOND PRESS ASKS THIS COLUMN TO RESET (Samuel, 2026-09-16) —
      // `use-channels-selection.ts › toggleAgent` bumps it when it closes the view.
      infoTabSignal={sel.infoTabSignal}
      mentions={mentions}
      mentionsTruncated={data.mentionsTruncated}
      mentionsLoading={data.mentionsLoading}
      onOpenMention={openMention}
      onMarkAllMentionsRead={markAllMentionsRead}
      // THE ARTIFACTS FACE (Samuel, 2026-09-16) — opt-in; /home and the
      // workspace channels page since R-16 (2026-09-17).
      artifacts={capabilities?.artifacts}
      headerEdit={headerEdit}
      // THE CURATED `channels.info_card` ROWS (Samuel's ruling R-19, 2026-09-17).
      infoCardEdit={{ onSave: infoCardWrite.save }}
      // WHICH OF THE TWO RULED MENTIONS FACES (Samuel, 2026-09-15) — the
      // capability's docblock carries the ruling.
      mentionsLayout={capabilities?.mentionsLayout}
      // 🔒 "No members in this channel." IS DERIVED, NOT A NEW FLAG: the hosts
      // that pass `memberManagement: false` are exactly the ones whose roster
      // always holds the reader, so the sentence could only ever flash falsely
      // there. `info-tab.tsx › rosterEmptyLine` carries the rest.
      rosterEmptyLine={capabilities?.memberManagement !== false}
      membersAction={
        canAddMembers ? (
          <>
            <button
              type="button"
              onClick={() => setInviteOpen(true)}
              // The shared recipe is FACE AND SCALE ONLY, so spacing stays at
              // the call site (`page-action-button.ts`).
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
                // The roster the surface holds, and the host's channel list —
                // the same pair `settings-slot.tsx` settles this dialog into.
                onChanged={() => {
                  onRosterChanged?.();
                  data.refetchMembers();
                }}
              />
            )}
          </>
        ) : null
      }
      // ⚠ CALLED, not passed: the extras are a render function so they can be
      // handed THIS surface's refetch gate. This was `infoTab` and it REPLACED
      // the body (deleted wave 1A, 2026-09-17) — `ChannelInfoExtras` and
      // `ChannelInfoTabContext` carry why, and what each field costs.
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
      // THE SETTINGS TAB (Samuel, 2026-08-19), thread-scoped while a thread is
      // open (2026-08-21) — the branch is `settings-slot.tsx`.
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
          // ⚠ Fires on a thread DELETE and nothing else, so it is where the
          // scroll-back window is told — the cache's half is the optimistic
          // patch in `use-thread-lifecycle-writes.ts`, which the window is not in.
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

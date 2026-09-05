"use client";

/**
 * THE TAB COLUMN, WIRED TO A SURFACE — `info-panel.tsx` plus every fact it
 * needs, the Settings slot it is handed, and the two mention actions that are
 * only ever taken from inside it.
 *
 * ⚠ EXTRACTED FROM `channel-surface.tsx` ON 2026-09-04, at the 500-line cap,
 * when the web's single-column layout needed room in that file — the same seam
 * `surface-agent-view.tsx` was cut on the same day: the surface owns WHICH panes
 * it shows, these two files own how each one is wired. **Nothing inside changed
 * in the move**; every ⚠ below is that file's.
 *
 * ⚠ IT RENDERS AT TWO WIDTHS FROM ONE DEFINITION (`fullTab`). Absent is the
 * desktop's 380px column with its tab row; present is ONE face as the main area,
 * for a phone where the column and the conversation cannot share the screen.
 *
 * ⚠ IT FETCHES NOTHING. Every read is `ChannelSurfaceData`, mounted once by the
 * HOST (INVARIANTS §7).
 */

import type { Role } from "@/features/workspaces/types";
import { ChannelsV2SettingsSlot } from "./settings-slot";
import { ChannelsV2InfoPanel, type TabKey } from "./info-panel";
import type { ChannelSurfaceData } from "./channel-surface-data";
import type { ChannelsV2Selection } from "./use-channels-v2-selection";
import type { ChannelWebView } from "./use-channel-web-view";
import type {
  ChannelSurfaceCapabilities,
  ChannelSurfaceSlots,
} from "./channel-surface";
import type { Channel, ChannelMention } from "../../types";

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
  selection: ChannelsV2Selection;
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

  // ⚠ ON ONE COLUMN, OPENING A TRANSCRIPT HAS TO MOVE THE FACE TOO. A thread
  // picked out of the Threads list, a mention jumped to, a new-thread panel
  // asked for — all three land in the CONVERSATION, which is a different face
  // there and merely the pane next door on the desktop. A no-op without
  // `webView`, so every desktop mount is unchanged.
  const showChannel = () => webView?.setView("channel");

  // The Tags inbox's click: mark read, land the center pane on the right
  // transcript, then signal the scroll. The scroll effect runs POST-render, so
  // the swapped transcript is in the DOM before it looks for the message row.
  //
  // ⚠ The mark-read is OPTIMISTIC (`use-mention-writes.ts`), which is what makes
  // the badge drop in the same frame as the navigation. The nonced scroll signal
  // is `use-channels-v2-selection.ts › jumpToMessage`.
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

  // ⚠ MARK-ALL SENDS THE IDS IT IS DISPLAYING, never a flag. The list is
  // bounded and says when it clipped, so "all" can only honestly mean the page
  // — and naming the ids makes that true by construction rather than by comment
  // (INVARIANTS §9). Already-read rows are filtered out so a no-op click sends
  // no request at all.
  const markAllMentionsRead = () => {
    const unread = mentions.filter((m) => !m.read).map((m) => m.messageId);
    if (unread.length === 0) return;
    data.markRead.mutate({ channelId: channel.id, messageIds: unread });
  };

  return (
    <ChannelsV2InfoPanel
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
      // ⚠ THE NAME ROW IS THE FULL-TAB FACE'S ONLY TITLE. At this width the
      // single column has hidden its header crumb, so the row inside the pane is
      // what names the channel; in the two-column tab column the header above is
      // still showing it and a second copy is the duplicate Samuel reported.
      showNameRow={fullTab === "info"}
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
      canLaunchAgent={
        agentsPanel.canLaunch &&
        !!openThread &&
        (openThread.createdBy === currentUserId ||
          openThread.targetUserId === currentUserId)
      }
      launchBusy={agentsPanel.launchBusy}
      launchError={agentsPanel.launchError}
      // ⚠ THE PROMISE IS HANDED THROUGH, not voided (2026-08-22). The
      // template picker inside the tab AWAITS this to learn whether main
      // asked for a first-use approval; a `void` wrapper here would make
      // every picker launch look like a build with no bridge.
      onLaunchAgent={(id, templateId, overrides) =>
        agentsPanel.launchAgent(id, templateId, overrides)
      }
      onApproveTemplate={agentsPanel.approveTemplate}
      openAgent={sel.openAgent}
      onOpenAgent={sel.setOpenAgent}
      mentions={mentions}
      mentionsTruncated={data.mentionsTruncated}
      mentionsLoading={data.mentionsLoading}
      onOpenMention={openMention}
      onMarkAllMentionsRead={markAllMentionsRead}
      // THE KNOWLEDGE TAB (M4) — opt-in, see `ChannelSurfaceCapabilities`.
      knowledge={capabilities?.knowledge}
      // ⚠ CALLED, not passed. The tab is a render function so it can be
      // handed THIS surface's refetch gate — see `ChannelInfoTabContext`.
      infoTab={slots?.infoTab?.({ gate })}
      // THE SETTINGS TAB (Samuel, 2026-08-19). This cluster hung off the
      // pane HEADER until then; the header keeps only the info toggle.
      // ⚠ THREAD-SCOPED WHILE A THREAD IS OPEN (2026-08-21) — the branch
      // is `settings-slot.tsx`, which owns why it lives at the MOUNT.
      settings={
        <ChannelsV2SettingsSlot
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
          // ⚠ THIS SLOT'S `onExitThread` FIRES ON A THREAD DELETE AND
          // NOTHING ELSE (`settings-slot.tsx` wires it to `onDeleted`), so
          // it is where the scroll-back window is told. The query cache's
          // half of the same cascade is the optimistic patch in
          // `use-thread-lifecycle-writes.ts`; the window is not in that
          // cache, and a reader scrolled back through history would
          // otherwise keep rendering the deleted rows.
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

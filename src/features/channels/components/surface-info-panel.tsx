"use client";

/**
 * THE TAB COLUMN, WIRED TO A SURFACE — `info-panel.tsx` plus every fact it needs,
 * the Settings slot, and the two mention actions taken only from inside it.
 *
 * ⚠ EXTRACTED FROM `channel-surface.tsx` ON 2026-09-04, at the 500-line cap — the
 * seam `surface-agent-view.tsx` was cut on the same day: the surface owns WHICH
 * panes it shows, these two own how each is wired. **Nothing inside changed in the
 * move**; every ⚠ below is that file's.
 *
 * ⚠ IT RENDERS AT TWO WIDTHS FROM ONE DEFINITION (`fullTab`): absent is the
 * desktop's 380px column with its tab row, present is ONE face as the main area.
 * ⚠ IT FETCHES NOTHING — every read is `ChannelSurfaceData`, mounted once by the
 * HOST (INVARIANTS §7).
 */

import { meetsMinRole, type Role } from "@/features/workspaces/types";
import { useChannelHeaderWrite } from "../hooks/use-channel-header-writes";
import { useChannelInfoCardWrite } from "../hooks/use-channel-info-card-writes";
import { ChannelsSettingsSlot } from "./settings-slot";
import { ChannelsInfoPanel, type TabKey } from "./info-panel";
import type { ChannelSurfaceData } from "./channel-surface-data";
import type { ChannelsSelection } from "./use-channels-selection";
import type { ChannelWebView } from "./use-channel-web-view";
import type {
  ChannelSurfaceCapabilities,
  ChannelSurfaceSlots,
} from "./channel-surface";
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
   * THE INFO TAB'S CLICK-TO-EDIT NAME + DESCRIPTION (Samuel, 2026-09-16).
   *
   * ⚠ IT TAKES THIS SURFACE'S ONE `gate`, like every other write wired here
   * (INVARIANTS §7/§8: one `useRefetchGate` per live surface). A second
   * coordinator would let the realtime doorbell repaint the old name mid-write.
   * ⚠ NO NEW ENDPOINT — `PATCH /api/channels/[channelId]`, the same route the
   * Settings tab's lifecycle writes and the info card already use.
   */
  const headerWrite = useChannelHeaderWrite({
    channelId: channel.id,
    workspaceId,
    gate,
  });
  /**
   * ⚠ **ONE BUNDLE, TWO CONSUMERS, AND THAT IS THE 2026-09-17 CHANGE.** It is
   * handed to the DEFAULT Info tab below AND to an injected `infoTab` slot, so
   * /home's own composition edits the same two rows through the same write and the
   * same mirror rather than restating either (`ChannelInfoTabContext.headerEdit`).
   * ⚠ **THE SAME PAIR THE SERVER'S GATE READS** (`service-shared.ts ›
   * canManageChannel`): channel owner, or workspace admin. Mirrored rather than
   * guessed, exactly as `settings-slot.tsx` mirrors it two blocks down, so the
   * line's editable face matches the answer the PATCH will give — an affordance
   * that always 403s is a dead control (INVARIANTS §5).
   * ⚠ **THE DERIVED-NAME HALF IS THE TAB'S** (`info-tab.tsx › headerEditable`),
   * because it is a fact about the ROW rather than about the reader.
   */
  const headerEdit = {
    canEdit: channel.role === "owner" || meetsMinRole(role, "admin"),
    onSaveName: headerWrite.saveName,
    onSaveTopic: headerWrite.saveTopic,
    busy: headerWrite.pending,
  };
  /**
   * THE CURATED INFO CARD'S WRITE (Samuel's ruling R-19, 2026-09-17).
   *
   * ⚠ **THE SAME GATE AGAIN, AND THAT IS WHY IT IS MINTED HERE AND NOT IN THE
   * TAB** (INVARIANTS §7/§8: one `useRefetchGate` per live surface). /home's own
   * card already minted this hook from the gate this file hands down
   * (`pages/home/person-info-tab.tsx`); the DEFAULT body had no write at all, which
   * is why a workspace channel's curated rows were stored, validated,
   * PATCH-writable — and invisible.
   * ⚠ **MEMBERSHIP-GATED, NOT MANAGE-GATED, AND DELIBERATELY SO** (Samuel,
   * 2026-08-25; `service-writes.ts › updateChannel`): the card is content the room
   * carries, not part of its lifecycle. So there is no `canEdit` half to mirror
   * here — unlike `headerEdit` directly above.
   * ⚠ **NO NEW ENDPOINT** — `PATCH /api/channels/[channelId]`, the same route the
   * header write and the lifecycle writes already use.
   */
  const infoCardWrite = useChannelInfoCardWrite({
    channelId: channel.id,
    workspaceId,
    gate,
  });

  // ⚠ ON ONE COLUMN, OPENING A TRANSCRIPT HAS TO MOVE THE FACE TOO — a picked
  // thread, a jumped-to mention and a new-thread ask all land in the
  // CONVERSATION, which is a different face there and the pane next door on the
  // desktop. A no-op without `webView`, so every desktop mount is unchanged.
  const showChannel = () => webView?.setView("channel");

  // The Tags inbox's click: mark read, land the center pane on the right
  // transcript, then signal the scroll (the effect runs POST-render, so the
  // swapped transcript is in the DOM first). ⚠ The mark-read is OPTIMISTIC
  // (`use-mention-writes.ts`), which drops the badge in the navigation's own
  // frame; the nonced signal is `use-channels-selection.ts › jumpToMessage`.
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
      // ⚠ THE PROMISE IS HANDED THROUGH, not voided (2026-08-22): the template
      // picker AWAITS it to learn whether main asked for a first-use approval, and
      // a `void` wrapper would make every picker launch look like a dead bridge.
      onLaunchAgent={(id, templateId, overrides) =>
        agentsPanel.launchAgent(id, templateId, overrides)
      }
      onApproveTemplate={agentsPanel.approveTemplate}
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
      // THE ARTIFACTS FACE (Samuel, 2026-09-16) — opt-in, /home only; same place.
      artifacts={capabilities?.artifacts}
      // CLICK-TO-EDIT NAME + DESCRIPTION (Samuel, 2026-09-16) — see `headerEdit`
      // above for the permission and why it is mirrored.
      headerEdit={headerEdit}
      // THE CURATED `channels.info_card` ROWS (Samuel, 2026-09-17) — see
      // `infoCardWrite` above. ⚠ NOT on the `infoTab` context: /home's injected tab
      // mints this same hook from the same gate already, and collapsing the two is
      // the ONE-BODY step, not this one.
      infoCardEdit={{ onSave: infoCardWrite.save }}
      // ⚠ CALLED, not passed. The tab is a render function so it can be
      // handed THIS surface's refetch gate — see `ChannelInfoTabContext`.
      // ⚠ THE BUNDLE GOES WITH THE GATE (2026-09-15). The slot REPLACES the tab
      // body, so a host that injects one used to lose the Tags section even
      // though this component had already fetched it — that was the home space's
      // missing-mentions gap, and nothing about the query had to change. Same
      // page, same handlers, same centre-pane scroll.
      // ⚠ **AND THE HEADER EDIT GOES WITH THEM (2026-09-17)** — same argument,
      // one ruling later: the slot REPLACES the body, so /home's Info tab drew
      // display-only Name and Description rows while this surface had already
      // minted the write for the tab it was not rendering.
      infoTab={slots?.infoTab?.({
        gate,
        headerEdit,
        // ⚠ **THE SURFACE'S OWN READS, HANDED DOWN (wave 1A, 2026-09-17).** Each
        // of these was mounted a SECOND time downstream before it was on the
        // context — `members` three times, `activity` twice — and `index` was
        // not re-derived at all, which is how a roster came to be drawn with no
        // viewer and the operator read as offline in their own channel (F-723).
        // See `ChannelInfoTabContext` for each field's rule.
        members,
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
      // THE SETTINGS TAB (Samuel, 2026-08-19) — this cluster hung off the pane
      // HEADER until then. ⚠ THREAD-SCOPED WHILE A THREAD IS OPEN (2026-08-21):
      // the branch is `settings-slot.tsx`, which owns why it lives at the MOUNT.
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
          // ⚠ THIS SLOT'S `onExitThread` FIRES ON A THREAD DELETE AND NOTHING
          // ELSE (`settings-slot.tsx` wires it to `onDeleted`), so it is where the
          // scroll-back window is told. The cache's half is the optimistic patch in
          // `use-thread-lifecycle-writes.ts`; the window is not in that cache.
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

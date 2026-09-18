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

import { useState } from "react";
import { meetsMinRole, type Role } from "@/features/workspaces/types";
import { cn } from "@/shared/lib/utils";
import { PAGE_ACTION_BTN } from "@/shared/ui/page-action-button";
import { InviteDialog } from "./invite-dialog";
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
   * in its own forked body, deleted in wave 1A; the DEFAULT body had no write at all, which
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

  /**
   * 🔒 **ADD MEMBER, ON THE Members HEADING — F-721 RESOLVED (Samuel, 2026-09-17,
   * answering R-46's option (b) yes).**
   *
   * ⚠ **THE GATE IS THE SERVER'S FLOOR, MIRRORED — NOT A NEW RULE.**
   * `channel-manage.tsx` hands the same dialog `canManage || meetsMinRole(role,
   * "admin")` for the Settings row, so the two openers of one dialog cannot
   * disagree about who may open it, and `headerEdit.canEdit` above is the same
   * conjunction a third time on this surface.
   * ⚠ **AND IT RIDES `memberManagement`,** which is what makes it absent on /home
   * and the guest lane: a container's roster cannot be added to this way at ANY
   * size (§4A — every workspace-level add answers `LINK_CONTAINER_CLOSED`), so the
   * control would name an operation that always fails. That is the same reason
   * `settings-tab.tsx` gates its **Add members** row on the flag.
   * ⚠ **HIDDEN, NOT DISABLED** — there is no refusal to explain to somebody who
   * was never offered the act (INVARIANTS §5).
   * ⚠ **THE DIALOG IS MOUNTED ONLY WHILE OPEN**, for `settings-slot.tsx`'s reason:
   * it opens two reads and the add/remove writes, and none of that has any
   * business being live behind a tab nobody has acted on. Closed, `ModalShell`
   * renders null anyway, so this costs the DOM nothing and saves the reads.
   */
  const canAddMembers =
    capabilities?.memberManagement !== false &&
    (channel.role === "owner" || meetsMinRole(role, "admin"));
  const [inviteOpen, setInviteOpen] = useState(false);

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
      // 🔒 **WHICH OF THE TWO RULED MENTIONS FACES (Samuel, 2026-09-15).** The
      // capability's docblock carries the ruling and why the POSITION travels
      // with the face; the body branches once over it.
      mentionsLayout={capabilities?.mentionsLayout}
      // 🔒 **"No members in this channel." IS DERIVED, NOT A NEW FLAG.** The
      // hosts that pass `memberManagement: false` — /home and the guest lane —
      // are exactly the ones whose roster ALWAYS holds the reader, because the
      // only door in is a link that reader claimed (§4A). There the sentence
      // could only appear for one frame of the roster read, stating something
      // false; `info-tab.tsx › rosterEmptyLine` carries the rest.
      rosterEmptyLine={capabilities?.memberManagement !== false}
      // 🔒 ADD MEMBER — see `canAddMembers` above for the gate and the mount rule.
      membersAction={
        canAddMembers ? (
          <>
            <button
              type="button"
              onClick={() => setInviteOpen(true)}
              // ⚠ THE SHARED RECIPE, spacing at the call site — the constant is
              // FACE AND SCALE ONLY (`page-action-button.ts`).
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
      // ⚠ CALLED, not passed. The extras are a render function so they can be
      // handed THIS surface's refetch gate — see `ChannelInfoTabContext`.
      // ⚠ **THIS WAS `infoTab`, AND IT REPLACED THE BODY (deleted wave 1A,
      // 2026-09-17).** Every field on the context below was added AFTER a host
      // that replaced the body dropped something this component had already paid
      // for — `mentions` 2026-09-15, `headerEdit` 2026-09-17, then `members` /
      // `index` / `activity` / `channelName` and F-723 with them. The regions a
      // host may fill now ADD to the one body (`ChannelInfoExtras`), so the class
      // is unexpressible rather than patched.
      infoExtras={slots?.infoExtras?.({
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

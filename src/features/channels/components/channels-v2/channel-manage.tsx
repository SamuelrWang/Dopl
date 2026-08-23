"use client";

/**
 * Channels v2 — THE CHANNEL-MANAGEMENT SURFACE, carried over WHOLESALE at the
 * cutover — INVARIANTS §5 records the ruling ("channel management maps over
 * wholesale — create, invite, visibility, delete, folders", second round of the
 * port's intent doc, deleted with the mock folder at that cutover).
 *
 * ⚠ IT NO LONGER HANGS OFF THE PANE HEADER (Samuel, 2026-08-19). The header's
 * right side is the info toggle and nothing else; this cluster is the RIGHT
 * PANEL'S SETTINGS TAB now, where the LINKS empty state used to be. What moved
 * is the HOST, not the controls: this file still owns every dialog, every write
 * hook and the one `gate`, and `settings-tab.tsx` is the rows it renders into.
 * The one control that changed shape is the kebab — `ChannelActionsMenu` was
 * deleted and its items are explicit rows, with both confirmations unchanged.
 *
 * ⚠ AND THE POPOVERS DIED LATER THE SAME DAY (Samuel, live review — the ruling
 * INVARIANTS §5 used to carry as open). `ChannelSettingsPopover` and
 * `ChannelFolderControl` were **deleted**, their controls rebuilt INLINE as
 * `settings-agent.tsx › ChannelAgentSettings`, which this file mounts into the
 * tab's `agent` slot. ⚠ **The wiring is untouched by that**: the same
 * `prefs.toolProfile`, the same bridges. Only the chrome changed, and a future
 * reader must not conclude a write moved.
 *
 * ⚠ THE TRUST HALF IS DELETED (Samuel, 2026-08-22 — the inbound consent
 * retirement). `useTrustRules`, `prefs.trust`, the `trustBusyIds` double-fire
 * guard and `handleToggleTrust` all went with the "Always allow" section they
 * fed: standing consent for an ask nobody is asked any more. **This surface no
 * longer opens `/api/channels/trust` at all**, so the "zero requests until the
 * tab opens" assertion in `pages/channels/index.test.tsx` now has one fewer read
 * to be true about.
 *
 * ⚠ THIS FILE EXISTS BECAUSE THE OLD PAGE'S HEADER WAS THE ONLY ENTRY POINT TO
 * FIVE LIVE CONTROLS. `channels-view-core.tsx` and `channel-pane.tsx` were
 * deleted at the cutover (wiring plan Phase 12) and they owned the dialogs'
 * open state, the lifecycle/preference writes and the confirm dialogs. Nothing
 * below is new product surface: every component, hook and copy string is the
 * one the shipping page rendered, re-hosted so the cutover orphans none of them.
 *
 * ⚠ SPLIT OUT OF `channels-v2-core.tsx` RATHER THAN INLINED — the core is the
 * three-column shell plus its reads, and this is the write-bearing chrome that
 * hangs off one channel. Two reasons to change, two files (INVARIANTS §1), and
 * the core has no room for the 500-line cap either way.
 *
 * ⚠ Next-free like the rest of the v2 tree. `ChannelsV2CreateDialogs` takes no
 * `Link`; the only router-dependent thing in the channels tree is the first-run
 * explainer, and it gets its `Link` from the page seam.
 */

import { useState } from "react";
import { meetsMinRole, type Role } from "@/features/workspaces/types";
import { ConfirmDialog } from "@/shared/ui/confirm-dialog";
import type { MutationGate } from "@/shared/hooks/use-api-mutation";
import { UNRESOLVED_TOOL_PROFILE } from "../../constants";
import { useChannelLifecycleWrites } from "../../hooks/use-channel-lifecycle-writes";
import { useChannelPreferenceWrites } from "../../hooks/use-channel-preference-writes";
import { channelDisplayName } from "../../lib/channel-display";
import { CreateChannelDialog } from "../create-channel-dialog";
import { DirectMessageDialog } from "../direct-message-dialog";
import { GoPublicDialog, needsGoPublicConfirm } from "../go-public-dialog";
import { InviteDialog } from "../invite-dialog";
import { ChannelAgentSettings } from "./settings-agent";
import { ChannelsV2SettingsTab } from "./settings-tab";
import type { AgentToolProfile, Channel, ChannelMember } from "../../types";

export interface ChannelsV2ManageProps {
  channel: Channel;
  workspaceId: string;
  workspaceSlug: string;
  currentUserId: string;
  role: Role;
  members: ChannelMember[];
  /** The page's ONE refetch coordinator — every write below settles into it. */
  gate: MutationGate;
  /**
   * Whether this container's membership can CHANGE (`channel-surface.tsx ›
   * ChannelSurfaceCapabilities`). Default `true` — the channels page. `false`
   * drops the invite row AND its dialog, because a host that cannot add members
   * must not mount a surface for doing it.
   */
  memberManagement?: boolean;
  /** A deleted channel must not stay selected. */
  onDeselect: () => void;
  /** Membership changed under the invite dialog — refetch list + roster. */
  onRosterChanged: () => void;
}

/**
 * The right panel's SETTINGS tab, whole: per-channel settings, the desktop-only
 * working folder, invite, and the lifecycle rows (visibility / archive / delete
 * / leave) with their confirm dialogs. It rendered as a header icon cluster
 * until 2026-08-19 — see the file docblock.
 *
 * ⚠ ALL THREE WRITE HOOKS TAKE THE PAGE'S `gate`, not a second coordinator.
 * INVARIANTS §7/§8: one `useRefetchGate` per live surface, or a realtime
 * doorbell mid-write reverts the optimistic patch under the click that set it.
 */
export function ChannelsV2ManageActions({
  channel,
  workspaceId,
  workspaceSlug,
  currentUserId,
  role,
  members,
  gate,
  memberManagement = true,
  onDeselect,
  onRosterChanged,
}: ChannelsV2ManageProps) {
  const [inviteOpen, setInviteOpen] = useState(false);
  const [goPublicOpen, setGoPublicOpen] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [confirmLeave, setConfirmLeave] = useState(false);

  const prefs = useChannelPreferenceWrites({ workspaceId, gate });
  const lifecycle = useChannelLifecycleWrites({
    channel,
    workspaceId,
    currentUserId,
    gate,
    onDeselect,
  });

  const canManage = channel.role === "owner";
  const displayName = channelDisplayName(channel, members, currentUserId);
  const peerName =
    displayName === "Direct message" ? "your teammate" : displayName;
  // ⚠ A row with no profile resolves the way the DESKTOP resolves it
  // (INVARIANTS §6). The Tools control renders this as a containment claim, so
  // the web must never pick a wider answer than the machine will run.
  const toolProfile = channel.myAgentToolProfile ?? UNRESOLVED_TOOL_PROFILE;

  /** ⚠ WIDENING TAKES A HUMAN: private→public confirms; public→private does not. */
  function handleToggleVisibility() {
    if (needsGoPublicConfirm(channel.visibility)) {
      setGoPublicOpen(true);
      return;
    }
    lifecycle.toggleVisibility();
  }

  function handleSetToolProfile(profile: AgentToolProfile) {
    prefs.toolProfile.mutate({ channelId: channel.id, profile });
  }

  return (
    <>
      <ChannelsV2SettingsTab
        channel={channel}
        canManage={canManage}
        memberManagement={memberManagement}
        // The agent half, INLINE (2026-08-19 ruling — see the file docblock).
        // A non-member has no agent settings of their own here, and passing
        // nothing is what gives them the tab's empty state.
        agent={
          channel.isMember ? (
            <ChannelAgentSettings
              channelId={channel.id}
              profile={toolProfile}
              onSetToolProfile={handleSetToolProfile}
              toolProfileBusy={prefs.toolProfile.pending}
            />
          ) : null
        }
        onInvite={() => setInviteOpen(true)}
        onToggleVisibility={handleToggleVisibility}
        onToggleArchive={lifecycle.toggleArchive}
        onRequestDelete={() => setConfirmDelete(true)}
        onRequestLeave={() => setConfirmLeave(true)}
      />

      <GoPublicDialog
        open={goPublicOpen}
        onOpenChange={setGoPublicOpen}
        displayName={channel.name}
        onConfirm={lifecycle.toggleVisibility}
      />

      {/* ⚠ NOT MOUNTED AT ALL when membership is fixed — the dialog opens a
          roster read of its own, and there is no row left to open it. */}
      {memberManagement && (
        <InviteDialog
          workspaceId={workspaceId}
          workspaceSlug={workspaceSlug}
          channelId={channel.id}
          currentUserId={currentUserId}
          canManage={canManage || meetsMinRole(role, "admin")}
          open={inviteOpen}
          onOpenChange={setInviteOpen}
          onChanged={onRosterChanged}
        />
      )}

      <ConfirmDialog
        open={confirmDelete}
        onOpenChange={setConfirmDelete}
        title={channel.isDirect ? "Delete conversation?" : "Delete channel?"}
        description={
          channel.isDirect
            ? `Your direct message with ${peerName} will be hidden. Opening it again later brings the history back.`
            : `"${displayName}", its messages and all its threads will be permanently deleted for everyone in the workspace. This can't be undone.`
        }
        confirmLabel={channel.isDirect ? "Delete" : "Delete permanently"}
        destructive
        onConfirm={lifecycle.remove}
      />

      {/* Leaving is a real membership DELETE, and on a PRIVATE channel the user
          cannot undo it (they see only public channels plus their own, and
          self-join is public-only). The copy states that asymmetry. */}
      <ConfirmDialog
        open={confirmLeave}
        onOpenChange={setConfirmLeave}
        title={`Leave "${displayName}"?`}
        description={
          channel.visibility === "private"
            ? `You'll lose access to "${displayName}" and its history. It's private, so you can't rejoin on your own — another member would have to invite you back.`
            : `You'll stop following "${displayName}" and its messages. It's a public channel, so you can rejoin whenever you like.`
        }
        confirmLabel="Leave"
        destructive={channel.visibility === "private"}
        onConfirm={lifecycle.leave}
      />
    </>
  );
}

/**
 * The two CREATE dialogs, behind the sidebar's `+` buttons. Split from the
 * header cluster because they are workspace-scoped, not channel-scoped: they
 * must mount when the workspace has NO channel at all, which is exactly when
 * the header does not exist.
 */
export function ChannelsV2CreateDialogs({
  workspaceId,
  workspaceSlug,
  currentUserId,
  createOpen,
  directOpen,
  onCreateOpenChange,
  onDirectOpenChange,
  onCreated,
}: {
  workspaceId: string;
  workspaceSlug: string;
  currentUserId: string;
  createOpen: boolean;
  directOpen: boolean;
  onCreateOpenChange: (open: boolean) => void;
  onDirectOpenChange: (open: boolean) => void;
  /** Select the new channel and refetch the list. */
  onCreated: (channel: Channel) => void;
}) {
  return (
    <>
      <CreateChannelDialog
        workspaceId={workspaceId}
        workspaceSlug={workspaceSlug}
        open={createOpen}
        onOpenChange={onCreateOpenChange}
        onCreated={onCreated}
      />
      <DirectMessageDialog
        workspaceId={workspaceId}
        workspaceSlug={workspaceSlug}
        currentUserId={currentUserId}
        open={directOpen}
        onOpenChange={onDirectOpenChange}
        onCreated={onCreated}
      />
    </>
  );
}

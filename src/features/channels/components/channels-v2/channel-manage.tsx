"use client";

/**
 * Channels v2 — THE CHANNEL-MANAGEMENT SURFACE, carried over WHOLESALE at the
 * cutover (MAPPING.md § Q&A second round: "channel management maps over
 * wholesale — create, invite, visibility, delete, folders").
 *
 * ⚠ THIS FILE EXISTS BECAUSE THE OLD PAGE'S HEADER WAS THE ONLY ENTRY POINT TO
 * FIVE LIVE CONTROLS. `channels-view-core.tsx` and `channel-pane.tsx` were
 * deleted at the cutover (wiring plan Phase 12) and they owned the dialogs'
 * open state, the lifecycle/preference writes and the confirm dialogs. Nothing
 * below is new product surface: every component, hook and copy string is the
 * one the shipping page rendered, re-hosted on the v2 header so the cutover
 * orphans none of them.
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
import { UserPlus } from "lucide-react";
import { meetsMinRole, type Role } from "@/features/workspaces/types";
import { ConfirmDialog } from "@/shared/ui/confirm-dialog";
import type { MutationGate } from "@/shared/hooks/use-api-mutation";
import { UNRESOLVED_TOOL_PROFILE } from "../../constants";
import { useChannelLifecycleWrites } from "../../hooks/use-channel-lifecycle-writes";
import { useChannelPreferenceWrites } from "../../hooks/use-channel-preference-writes";
import { useTrustRules } from "../../hooks/use-trust-rules";
import { channelDisplayName } from "../../lib/channel-display";
import { ChannelActionsMenu } from "../channel-actions-menu";
import { ChannelFolderControl } from "../channel-folder-control";
import { ChannelSettingsPopover } from "../channel-settings-popover";
import { CreateChannelDialog } from "../create-channel-dialog";
import { DirectMessageDialog } from "../direct-message-dialog";
import { GoPublicDialog, needsGoPublicConfirm } from "../go-public-dialog";
import { InviteDialog } from "../invite-dialog";
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
  /** A deleted channel must not stay selected. */
  onDeselect: () => void;
  /** Membership changed under the invite dialog — refetch list + roster. */
  onRosterChanged: () => void;
}

/**
 * The v2 pane header's manage cluster: per-channel settings, the desktop-only
 * working folder, invite, and the kebab (visibility / archive / delete / leave)
 * with its confirm dialogs.
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
  onDeselect,
  onRosterChanged,
}: ChannelsV2ManageProps) {
  const [inviteOpen, setInviteOpen] = useState(false);
  const [goPublicOpen, setGoPublicOpen] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [confirmLeave, setConfirmLeave] = useState(false);
  // ⚠ Double-fire guard ONLY — the optimistic half is a cache patch.
  const [trustBusyIds, setTrustBusyIds] = useState<ReadonlySet<string>>(
    () => new Set<string>()
  );

  const { trustedIds } = useTrustRules(workspaceId);
  const prefs = useChannelPreferenceWrites({ workspaceId, currentUserId, gate });
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
  const otherMembers = members.filter((m) => m.userId !== currentUserId);
  // ⚠ A row with no profile resolves the way the DESKTOP resolves it
  // (INVARIANTS §6). The settings popover renders this as a containment claim,
  // so the web must never pick a wider answer than the machine will run.
  const settingsChannel: Channel = {
    ...channel,
    myAgentToolProfile: channel.myAgentToolProfile ?? UNRESOLVED_TOOL_PROFILE,
  };

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

  async function handleToggleTrust(userId: string, trusted: boolean) {
    if (trustBusyIds.has(userId)) return;
    setTrustBusyIds((s) => new Set(s).add(userId));
    try {
      await prefs.trust.mutateAsync({ userId, trusted });
    } catch {
      // Rollback + toast are the mutation's; this only clears the guard.
    } finally {
      setTrustBusyIds((s) => {
        const next = new Set(s);
        next.delete(userId);
        return next;
      });
    }
  }

  return (
    <>
      {channel.isMember && (
        <ChannelSettingsPopover
          channel={settingsChannel}
          otherMembers={otherMembers}
          trustedIds={trustedIds}
          trustBusyIds={trustBusyIds}
          onSetToolProfile={handleSetToolProfile}
          toolProfileBusy={prefs.toolProfile.pending}
          onToggleTrust={handleToggleTrust}
        />
      )}

      {/* Desktop-only: the responding agent's working folder. Renders nothing
          in a plain browser (feature-detected on window.dopl). */}
      {channel.isMember && <ChannelFolderControl channelId={channel.id} />}

      {/* A DM is a fixed 1:1 pair — no invite affordance (server also rejects). */}
      {channel.isMember && !channel.isDirect && (
        <button
          type="button"
          onClick={() => setInviteOpen(true)}
          aria-label="Add members"
          title="Add members"
          className="flex h-7 w-7 shrink-0 items-center justify-center rounded-[7px] text-text-secondary transition-colors hover:bg-surface-raised-1 hover:text-text-primary"
        >
          <UserPlus size={16} />
        </button>
      )}

      <ChannelActionsMenu
        channel={channel}
        canManage={canManage}
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

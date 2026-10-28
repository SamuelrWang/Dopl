"use client";

/**
 * Channels — the right panel's SETTINGS tab in channel view: "Agent Settings" (the viewer's own
 * agent rows and Responder) and "Channel" (invite, visibility, delete, leave), each one white card
 * (`settings-agent-rows.tsx › SettingsSection`). Every setting is inline; the destructive rows only
 * report intent, and `channel-manage.tsx` owns every confirm dialog.
 *
 * ⚠ NO DEAD ROWS (INVARIANTS §5): desktop-only rows are gated on their own bridge inside
 * `settings-agent.tsx`, and a reader with nothing to change gets the empty state, never a heading
 * over nothing.
 */

import { Hash, LogOut, Settings2, Trash2, UserPlus } from "lucide-react";
import type { ReactNode } from "react";
import { EmptyState } from "@/shared/ui/empty-state";
import { SettingAction, SettingsSection } from "./settings-agent-rows";
import type { Channel } from "../types";

interface ChannelsSettingsTabProps {
  channel: Channel;
  /** Owner OR workspace admin — the server gate (`service-shared.ts › canManageChannel`). */
  canManage: boolean;
  /** Channel ownership alone. Only "Leave channel" asks this: an admin who is a
   *  member may still leave, and the owner may not. */
  isChannelOwner: boolean;
  /**
   * `settings-agent.tsx › ChannelAgentSettings`, injected as a SLOT (its roster and write handlers
   * live in `channel-manage.tsx`). `null` for a non-member, who has no agent settings here.
   */
  agent?: ReactNode;
  /**
   * `settings-channel-agents.tsx › ChannelAgentsSettings` (Responder), on the `agent` slot's terms.
   * Gated on MEMBERSHIP, not manage: it writes the viewer's own membership row. It counts toward
   * the content check below, so a member whose lifecycle rows are all suppressed still gets it.
   */
  channelAgents?: ReactNode;
  /**
   * Whether this container's membership can CHANGE (`channel-surface.tsx ›
   * ChannelSurfaceCapabilities`). Default `true`. `false` drops the invite row
   * AND the delete row — NO DEAD ROWS is the rule this section already keeps,
   * and "Add members" in a fixed two-person container is the deadest of them.
   * Delete goes with it because the container's one channel is not the caller's
   * to remove; see `canDelete` below.
   */
  memberManagement?: boolean;
  /**
   * Whether the viewer manages their OWN stake in this channel — the
   * membership row they hold (Leave) and the agent they run in it
   * (`ChannelAgentSettings`, gated in `channel-manage.tsx`). Default `true`.
   * `false` is the guest lane (`/c/{workspaceId}`, ruling R2/R3 2026-08-25):
   * a guest's only surface IS this channel, so leaving is one-way with no way
   * back (the link was revoked at claim), and the tool profile governs an
   * agent session a guest never runs. NO DEAD ROWS, and no irreversible ones
   * either.
   */
  selfManagement?: boolean;
  onInvite: () => void;
  onToggleVisibility: () => void;
  /** Opens the delete CONFIRMATION — this tab never deletes directly. */
  onRequestDelete: () => void;
  /**
   * Opens the leave CONFIRMATION. ⚠ Leaving is a real membership DELETE and on a
   * private channel the user cannot undo it, which is why it was never a
   * one-click item and is not one here either.
   */
  onRequestLeave: () => void;
}

export function ChannelsSettingsTab({
  channel,
  canManage,
  isChannelOwner,
  agent,
  channelAgents,
  memberManagement = true,
  selfManagement = true,
  onInvite,
  onToggleVisibility,
  onRequestDelete,
  onRequestLeave,
}: ChannelsSettingsTabProps) {
  // A DM is a fixed 1:1 pair — no invite affordance (the server also rejects).
  const canInvite = memberManagement && channel.isMember && !channel.isDirect;
  // A DM is always private (immutable), so it has no visibility toggle.
  const canToggleVisibility = canManage && !channel.isDirect;
  // The non-owner's exit. A DM must NEVER offer "Leave channel": leaving deletes
  // one of the pair's two membership rows, which the server refuses because THAT
  // is what destroys the conversation permanently. Both DM participants get the
  // reversible "Delete conversation" instead.
  const canLeave =
    selfManagement && channel.isMember && !isChannelOwner && !channel.isDirect;
  // ⚠ `memberManagement: false` KILLS DELETE TOO, not just invite. In a fixed
  // two-person container the channel IS the relationship: deleting it leaves a
  // container whose relationship can no longer be rendered by either side, and
  // the host's own list still holds the row. NO DEAD ROWS, and this one was
  // worse than dead — it worked.
  const canDelete =
    memberManagement && (canManage || (channel.isMember && channel.isDirect));

  const hasActions = canInvite || canToggleVisibility || canDelete || canLeave;

  if (!agent && !channelAgents && !hasActions) {
    // ⚠ TWO AUDIENCES REACH THIS EMPTY STATE and only one of them can join: a
    // non-member browsing a public channel, and a MEMBER whose host turned the
    // management capabilities off (the guest lane, ruling R2/R3 2026-08-25).
    // Telling a member to "join" is a false sentence, so the description
    // branches on the one fact that separates them.
    return (
      <EmptyState
        icon={Settings2}
        title="Nothing to manage"
        description={
          channel.isMember
            ? "This channel has no settings for you to change."
            : "Join this channel to change how your agent answers in it."
        }
      />
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto px-3.5 pb-6 pt-3.5">
      {/* The viewer's own agent rows, then their own Responder rule, in one card; the room's
          lifecycle rows follow. */}
      {(agent || channelAgents) && (
        <SettingsSection title="Agent Settings">
          {agent}
          {channelAgents}
        </SettingsSection>
      )}

      {hasActions && (
        <SettingsSection title="Channel">
          {canInvite && (
            <SettingAction icon={UserPlus} label="Add members" onSelect={onInvite} />
          )}
          {canToggleVisibility && (
            <SettingAction
              icon={Hash}
              label={`Make ${channel.visibility === "public" ? "private" : "public"}`}
              onSelect={onToggleVisibility}
            />
          )}
          {canDelete && (
            <SettingAction
              icon={Trash2}
              label={`Delete ${channel.isDirect ? "conversation" : "channel"}`}
              destructive
              onSelect={onRequestDelete}
            />
          )}
          {canLeave && (
            <SettingAction icon={LogOut} label="Leave channel" onSelect={onRequestLeave} />
          )}
        </SettingsSection>
      )}
    </div>
  );
}

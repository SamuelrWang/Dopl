"use client";

/**
 * Channels v2 — the right panel's SETTINGS tab (Samuel, 2026-08-19).
 *
 * ⚠ THIS TAB IS WHERE THE PANE HEADER'S ACTION CLUSTER WENT. `message-pane.tsx`
 * used to carry six controls on the right of the breadcrumb — channel settings,
 * the working folder, invite, the kebab, an inert sparkle and the info toggle.
 * The ruling is that the CHANNEL header keeps only the info toggle, so the four
 * live ones moved here and the sparkle was deleted (it had no handler). **The
 * tab that used to sit in this slot was LINKS, a deliberate empty state**
 * ("No links in this channel yet."), and it dies with the rename rather than
 * being rehomed: where a channel's files and links land is still an open
 * question (wiring plan, Risk 10) and an empty tab was answering it with "here".
 *
 * ⚠ NOTHING BELOW IS NEW PRODUCT SURFACE, AND TWO CONTROLS ARE CARRIED VERBATIM.
 * `ChannelSettingsPopover` (the per-channel tool profile, the permission arm and
 * the per-teammate trust toggles) and `ChannelFolderControl` (the desktop-only
 * working folder) are mounted AS THEY ARE, popover and all — their product fate
 * is a separate open ruling and this change must not pre-empt it. What DID
 * change shape is the kebab: `ChannelActionsMenu` was deleted and its four items
 * are explicit rows here, because a kebab nested inside a tab is a menu hiding
 * inside a menu. **The destructive pair still routes through the confirm
 * dialogs** — these rows report intent upward exactly as the menu items did, and
 * `channel-manage.tsx` still owns every dialog.
 *
 * ⚠ NO DEAD ROWS (INVARIANTS §5 — every row on this surface functions). Both
 * desktop-only controls are gated on their own bridge, so a plain browser gets
 * no labelled row with nothing in it, and a non-member viewing a public channel
 * gets the empty state rather than a heading over nothing.
 */

import {
  Archive,
  ArchiveRestore,
  Folder,
  Hash,
  LogOut,
  Settings2,
  SlidersHorizontal,
  Trash2,
  UserPlus,
  type LucideIcon,
} from "lucide-react";
import type { ReactNode } from "react";
import { EmptyState } from "@/shared/ui/empty-state";
import { cn } from "@/shared/lib/utils";
import { ChannelFolderControl } from "../channel-folder-control";
import { useChannelFolder } from "../../hooks/use-channel-folder";
import { MetaRow, PanelHeading } from "./bits";
import type { Channel } from "../../types";

export interface ChannelsV2SettingsTabProps {
  channel: Channel;
  /** True for the channel owner — gates the manage half, as the kebab did. */
  canManage: boolean;
  /**
   * `ChannelSettingsPopover`, injected as a SLOT: it needs the roster, the trust
   * set and three write handlers, all of which live in `channel-manage.tsx`.
   * `null` for a non-member, who has no settings of their own here.
   */
  settings?: ReactNode;
  onInvite: () => void;
  onToggleVisibility: () => void;
  onToggleArchive: () => void;
  /** Opens the delete CONFIRMATION — this tab never deletes directly. */
  onRequestDelete: () => void;
  /**
   * Opens the leave CONFIRMATION. ⚠ Leaving is a real membership DELETE and on a
   * private channel the user cannot undo it, which is why it was never a
   * one-click item and is not one here either.
   */
  onRequestLeave: () => void;
}

export function ChannelsV2SettingsTab({
  channel,
  canManage,
  settings,
  onInvite,
  onToggleVisibility,
  onToggleArchive,
  onRequestDelete,
  onRequestLeave,
}: ChannelsV2SettingsTabProps) {
  // ⚠ READ FOR THE BRIDGE ALONE — the control below owns the label, the picker
  // and the busy flag. Asking here is what lets the ROW disappear in a plain
  // browser instead of standing empty; the hook is a bounded read either way
  // (one `getFolderLabel` over IPC) and is already shared by two surfaces.
  const { bridge: folderBridge } = useChannelFolder(channel.id);

  // A DM is a fixed 1:1 pair — no invite affordance (the server also rejects).
  const canInvite = channel.isMember && !channel.isDirect;
  // A DM is always private (immutable), so it has no visibility toggle.
  const canToggleVisibility = canManage && !channel.isDirect;
  // The non-owner's exit. A DM must NEVER offer "Leave channel": leaving deletes
  // one of the pair's two membership rows, which the server refuses because THAT
  // is what destroys the conversation permanently. Both DM participants get the
  // reversible "Delete conversation" instead.
  const canLeave = channel.isMember && !canManage && !channel.isDirect;
  const canDelete = canManage || (channel.isMember && channel.isDirect);

  const hasControls = Boolean(settings) || Boolean(folderBridge);
  const hasActions = canInvite || canToggleVisibility || canManage || canDelete || canLeave;

  if (!hasControls && !hasActions) {
    return (
      <EmptyState
        icon={Settings2}
        title="Nothing to manage"
        description="Join this channel to change how your agent answers in it."
      />
    );
  }

  return (
    <div className="min-h-0 flex-1 overflow-y-auto pb-6">
      {hasControls && (
        <>
          <PanelHeading title="Agent" />
          <div className="px-2">
            {settings && (
              <MetaRow icon={SlidersHorizontal} label="Permissions, sends & tools">
                {settings}
              </MetaRow>
            )}
            {folderBridge && (
              <MetaRow icon={Folder} label="Agent folder">
                <ChannelFolderControl channelId={channel.id} />
              </MetaRow>
            )}
          </div>
        </>
      )}

      {hasActions && (
        <>
          <PanelHeading title="Channel" />
          <div className="flex flex-col gap-px px-2">
            {canInvite && (
              <ActionRow icon={UserPlus} label="Add members" onSelect={onInvite} />
            )}
            {canToggleVisibility && (
              <ActionRow
                icon={Hash}
                label={`Make ${channel.visibility === "public" ? "private" : "public"}`}
                onSelect={onToggleVisibility}
              />
            )}
            {canManage && (
              <ActionRow
                icon={channel.archivedAt ? ArchiveRestore : Archive}
                label={channel.archivedAt ? "Unarchive" : "Archive"}
                onSelect={onToggleArchive}
              />
            )}
            {canDelete && (
              <ActionRow
                icon={Trash2}
                label={`Delete ${channel.isDirect ? "conversation" : "channel"}`}
                destructive
                onSelect={onRequestDelete}
              />
            )}
            {canLeave && (
              <ActionRow icon={LogOut} label="Leave channel" onSelect={onRequestLeave} />
            )}
          </div>
        </>
      )}
    </div>
  );
}

/**
 * One action row — the `MetaRow` geometry as a button, so the two sections in
 * this tab and the Info tab beside it read as one column.
 *
 * `destructive` is INK ONLY: the row opens a confirm dialog, it never performs
 * the write.
 */
function ActionRow({
  icon: Icon,
  label,
  destructive,
  onSelect,
}: {
  icon: LucideIcon;
  label: string;
  destructive?: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      className={cn(
        "flex h-10 w-full items-center gap-2 rounded-[8px] px-2 text-left text-small transition-colors",
        destructive
          ? "text-danger hover:bg-danger/10"
          : "text-text-secondary hover:bg-surface-raised-1 hover:text-text-primary"
      )}
    >
      <Icon size={14} className="shrink-0" />
      <span className="truncate">{label}</span>
    </button>
  );
}

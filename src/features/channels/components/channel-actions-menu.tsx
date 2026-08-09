"use client";

import { useState } from "react";
import {
  Archive,
  ArchiveRestore,
  Hash,
  LogOut,
  MoreHorizontal,
  Trash2,
} from "lucide-react";
import { MenuItem, Popover } from "@/shared/ui/popover-menu";
import type { Channel } from "../types";

interface MenuActions {
  onToggleVisibility: () => void;
  onToggleArchive: () => void;
  /** Opens the thread's delete confirmation (this menu never deletes directly). */
  onRequestDelete: () => void;
  /**
   * Opens the thread's LEAVE confirmation — this menu never leaves directly
   * either. It was `onLeave` and went straight to `removeChannelMember`, a real
   * SQL DELETE, on one click with no dialog. On a PRIVATE channel that is
   * unrecoverable by the user: `listChannels` returns public channels plus the
   * ones you belong to, and `addMember`'s self-join branch requires
   * `visibility === "public"`, so a misclick loses the room and its history
   * until another member re-invites you. Both destructive items now report
   * intent upward and the pane owns the dialog.
   */
  onRequestLeave: () => void;
}

/**
 * The channel header's kebab menu: the owner's manage actions (visibility,
 * archive, delete) or a plain member's exit. Owns its own open state — nothing
 * outside the header needs it — and reports the destructive intent upward so
 * the thread keeps the confirm dialog. Renders the trigger unconditionally; a
 * non-member viewing a public channel gets an empty popover (pre-existing
 * behavior, carried over unchanged from the inline version).
 */
export function ChannelActionsMenu({
  channel,
  canManage,
  ...actions
}: {
  channel: Channel;
  /** True for the channel owner — gates the manage half of the menu. */
  canManage: boolean;
} & MenuActions) {
  const [menuOpen, setMenuOpen] = useState(false);

  return (
    <div className="relative shrink-0">
      <button
        type="button"
        onClick={() => setMenuOpen((v) => !v)}
        aria-label="Channel actions"
        className="flex h-7 w-7 items-center justify-center rounded-[7px] text-text-secondary transition-colors hover:bg-surface-raised-1 hover:text-text-primary"
      >
        <MoreHorizontal size={16} />
      </button>
      <Popover open={menuOpen} onClose={() => setMenuOpen(false)} align="right">
        <ChannelActionsMenuItems
          channel={channel}
          canManage={canManage}
          onClose={() => setMenuOpen(false)}
          {...actions}
        />
      </Popover>
    </div>
  );
}

/**
 * The popover's contents, split out so they can be rendered (and asserted on)
 * without driving the trigger — `Popover` returns null while closed, and this
 * repo's component tests are static renders with no DOM to click.
 */
export function ChannelActionsMenuItems({
  channel,
  canManage,
  onClose,
  onToggleVisibility,
  onToggleArchive,
  onRequestDelete,
  onRequestLeave,
}: {
  channel: Channel;
  canManage: boolean;
  onClose: () => void;
} & MenuActions) {
  const select = (run: () => void) => () => {
    onClose();
    run();
  };

  return (
    <>
      {canManage && (
        <>
          {/* A DM is always private (immutable) — no visibility toggle. */}
          {!channel.isDirect && (
            <MenuItem icon={<Hash size={14} />} onSelect={select(onToggleVisibility)}>
              Make {channel.visibility === "public" ? "private" : "public"}
            </MenuItem>
          )}
          <MenuItem
            icon={
              channel.archivedAt ? (
                <ArchiveRestore size={14} />
              ) : (
                <Archive size={14} />
              )
            }
            onSelect={select(onToggleArchive)}
          >
            {channel.archivedAt ? "Unarchive" : "Archive"}
          </MenuItem>
          <MenuItem icon={<Trash2 size={14} />} destructive onSelect={select(onRequestDelete)}>
            Delete {channel.isDirect ? "conversation" : "channel"}
          </MenuItem>
        </>
      )}
      {/*
        The non-owner's exit. A DM must NEVER offer "Leave channel" (Q2):
        leaving deletes one of the pair's two membership rows, which the server
        refuses outright because THAT is what destroys the conversation
        permanently. The DM exit is the same REVERSIBLE "Delete conversation"
        the other side gets — it hides the thread for both and either side's
        next open brings it back with its history — so both participants see it.

        DO NOT re-word THIS branch as permanent. Since 2026-08-08 (C-16, F-173)
        `deleteChannel` BRANCHES on `is_direct`, and only the DM half is soft:
        a direct channel is stamped `channels.deleted_at` and `reviveChannel` /
        `reopenDirectChannel` restore the SAME row with its full history, so a
        tombstoned DM is LIVE PRODUCT STATE (migration 20260807110000 excludes
        the table for exactly that reason). Every OTHER channel now HARD-deletes
        and cascades — which is why the owner's "Delete channel" item above
        opens a dialog that says permanent, and this one must not. See
        ENGINEERING.md §7, "channels.deleted_at ... IS A DM-ONLY MECHANIC".
      */}
      {channel.isMember &&
        !canManage &&
        (channel.isDirect ? (
          <MenuItem
            icon={<Trash2 size={14} />}
            destructive
            onSelect={select(onRequestDelete)}
          >
            Delete conversation
          </MenuItem>
        ) : (
          <MenuItem icon={<LogOut size={14} />} onSelect={select(onRequestLeave)}>
            Leave channel
          </MenuItem>
        ))}
    </>
  );
}

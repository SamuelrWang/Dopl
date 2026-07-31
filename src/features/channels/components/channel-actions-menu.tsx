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
  onLeave: () => void;
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
  onLeave,
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
        now refuses outright because it destroys the conversation permanently.
        The DM exit is the same reversible "Delete conversation" the other side
        gets — it hides the thread for both and either side's next open brings
        it back with its history — so both participants see it.
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
          <MenuItem icon={<LogOut size={14} />} onSelect={select(onLeave)}>
            Leave channel
          </MenuItem>
        ))}
    </>
  );
}

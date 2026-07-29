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

/**
 * The channel header's kebab menu: the owner's manage actions (visibility,
 * archive, delete) or a plain member's Leave. Owns its own open state — nothing
 * outside the header needs it — and reports the destructive intent upward so
 * the thread keeps the confirm dialog. Renders the trigger unconditionally; a
 * non-member viewing a public channel gets an empty popover (pre-existing
 * behavior, carried over unchanged from the inline version).
 */
export function ChannelActionsMenu({
  channel,
  canManage,
  onToggleVisibility,
  onToggleArchive,
  onRequestDelete,
  onLeave,
}: {
  channel: Channel;
  /** True for the channel owner — gates the manage half of the menu. */
  canManage: boolean;
  onToggleVisibility: () => void;
  onToggleArchive: () => void;
  /** Opens the thread's delete confirmation (this menu never deletes directly). */
  onRequestDelete: () => void;
  onLeave: () => void;
}) {
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
        {canManage && (
          <>
            {/* A DM is always private (immutable) — no visibility toggle. */}
            {!channel.isDirect && (
              <MenuItem
                icon={<Hash size={14} />}
                onSelect={() => {
                  setMenuOpen(false);
                  onToggleVisibility();
                }}
              >
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
              onSelect={() => {
                setMenuOpen(false);
                onToggleArchive();
              }}
            >
              {channel.archivedAt ? "Unarchive" : "Archive"}
            </MenuItem>
            <MenuItem
              icon={<Trash2 size={14} />}
              destructive
              onSelect={() => {
                setMenuOpen(false);
                onRequestDelete();
              }}
            >
              Delete {channel.isDirect ? "conversation" : "channel"}
            </MenuItem>
          </>
        )}
        {channel.isMember && !canManage && (
          <MenuItem
            icon={<LogOut size={14} />}
            onSelect={() => {
              setMenuOpen(false);
              onLeave();
            }}
          >
            Leave channel
          </MenuItem>
        )}
      </Popover>
    </div>
  );
}

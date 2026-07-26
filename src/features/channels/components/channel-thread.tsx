"use client";

import { useEffect, useRef, useState } from "react";
import {
  Archive,
  ArchiveRestore,
  Hash,
  LogOut,
  MoreHorizontal,
  Trash2,
  UserPlus,
} from "lucide-react";
import { cn } from "@/shared/lib/utils";
import { MenuItem, Popover } from "@/shared/ui/popover-menu";
import { ConfirmDialog } from "@/shared/ui/confirm-dialog";
import type { Channel, ChannelMessage } from "../types";
import { MessageThread } from "./message-thread";
import { MessageComposer } from "./message-composer";

interface Props {
  channel: Channel;
  messages: ChannelMessage[];
  loading: boolean;
  onSend: (body: string) => Promise<void>;
  onInvite: () => void;
  onToggleArchive: () => void;
  onToggleVisibility: () => void;
  onDelete: () => void;
  onJoin: () => void;
  onLeave: () => void;
}

/**
 * Channel detail pane: a crumb bar (name, visibility, member count, topic)
 * with the manage kebab + invite action, a scrolling transcript that
 * auto-sticks to the bottom on new messages, and the pinned composer (or a
 * read-only / join affordance when the caller isn't a member).
 */
export function ChannelThread({
  channel,
  messages,
  loading,
  onSend,
  onInvite,
  onToggleArchive,
  onToggleVisibility,
  onDelete,
  onJoin,
  onLeave,
}: Props) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const canManage = channel.role === "owner";

  // Stick to the bottom when the transcript grows or the channel changes.
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages.length, channel.id]);

  return (
    <div className="flex min-w-0 flex-1 flex-col">
      <div className="flex h-[52px] shrink-0 items-center gap-2 border-b border-border-default px-3.5">
        <Hash size={15} className="shrink-0 text-text-muted" />
        <span className="shrink-0 truncate text-lead font-semibold text-text-primary">
          {channel.name}
        </span>
        <span className="shrink-0 rounded-full border border-border-strong bg-bg-inset px-1.5 py-px text-micro font-medium uppercase tracking-wide text-text-secondary">
          {channel.visibility}
        </span>
        {channel.topic && (
          <span className="min-w-0 truncate text-caption text-text-muted">
            {channel.topic}
          </span>
        )}
        <span className="flex-1" />
        <span className="shrink-0 text-caption text-text-muted">
          {channel.memberCount} {channel.memberCount === 1 ? "member" : "members"}
        </span>
        {channel.isMember && (
          <button
            type="button"
            onClick={onInvite}
            aria-label="Add members"
            title="Add members"
            className="flex h-7 w-7 items-center justify-center rounded-[7px] text-text-secondary transition-colors hover:bg-surface-raised-1 hover:text-text-primary"
          >
            <UserPlus size={16} />
          </button>
        )}
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
                <MenuItem
                  icon={<Hash size={14} />}
                  onSelect={() => {
                    setMenuOpen(false);
                    onToggleVisibility();
                  }}
                >
                  Make {channel.visibility === "public" ? "private" : "public"}
                </MenuItem>
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
                    setConfirmDelete(true);
                  }}
                >
                  Delete channel
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
      </div>

      <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto px-14 pt-6">
        <div className="mx-auto max-w-[760px]">
          {messages.length === 0 ? (
            <p className="py-10 text-center text-caption text-text-muted">
              {loading ? "Loading messages…" : "No messages yet."}
            </p>
          ) : (
            <MessageThread messages={messages} />
          )}
        </div>
      </div>

      {channel.isMember ? (
        <MessageComposer
          onSend={onSend}
          disabled={channel.archivedAt !== null}
          placeholder={
            channel.archivedAt
              ? "This channel is archived"
              : `Message #${channel.slug}`
          }
        />
      ) : (
        <div className="shrink-0 px-14 pb-6 pt-2">
          <div className="mx-auto flex max-w-[760px] items-center justify-between gap-3 rounded-[12px] border border-border-default bg-bg-elevated px-4 py-3">
            <span className="text-caption text-text-secondary">
              You are viewing this public channel.
            </span>
            <button
              type="button"
              onClick={onJoin}
              className={cn(
                "btn-light shrink-0 rounded-[8px] px-3 py-1.5 text-small font-medium text-text-primary"
              )}
            >
              Join channel
            </button>
          </div>
        </div>
      )}

      <ConfirmDialog
        open={confirmDelete}
        onOpenChange={setConfirmDelete}
        title="Delete channel?"
        description={`"${channel.name}" and its messages will be removed. This can't be undone from here.`}
        confirmLabel="Delete"
        destructive
        onConfirm={onDelete}
      />
    </div>
  );
}

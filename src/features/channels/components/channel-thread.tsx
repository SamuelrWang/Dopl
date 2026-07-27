"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  Archive,
  ArchiveRestore,
  Bell,
  BellOff,
  Hash,
  LogOut,
  MoreHorizontal,
  Trash2,
  UserPlus,
} from "lucide-react";
import { cn } from "@/shared/lib/utils";
import { MenuItem, Popover } from "@/shared/ui/popover-menu";
import { Avatar } from "@/shared/ui/avatar";
import { AvatarStack } from "@/shared/ui/avatar-stack";
import { ConfirmDialog } from "@/shared/ui/confirm-dialog";
import type {
  AgentToolProfile,
  Channel,
  ChannelConsentRequest,
  ChannelMember,
  ChannelMessage,
  ChannelTask,
  NotifyScope,
} from "../types";
import {
  channelDisplayAvatarPerson,
  channelDisplayName,
} from "../lib/channel-display";
import { MessageThread } from "./message-thread";
import { MessageComposer, type SendOptions } from "./message-composer";
import { PendingRequestsPanel } from "./pending-requests-panel";
import { ChannelSettingsPopover } from "./channel-settings-popover";
import { ChannelFolderControl } from "./channel-folder-control";
import { PresenceDot } from "./address-picker";

/** The three per-channel notification choices, shown in the bell popover. */
const NOTIFY_OPTIONS: Array<{
  scope: NotifyScope;
  label: string;
  description: string;
}> = [
  {
    scope: "all",
    label: "All activity",
    description: "Requests to you prompt; other activity notifies quietly.",
  },
  {
    scope: "addressed",
    label: "Addressed to me only",
    description: "Notify only when a request names you.",
  },
  { scope: "none", label: "Muted", description: "No notifications from this channel." },
];

interface Props {
  channel: Channel;
  messages: ChannelMessage[];
  /** The channel's first-class tasks — the thread's status / title overlay. */
  tasks: ChannelTask[];
  /** True while the task overlay is still loading — suppresses the status
   *  flicker (a UUID task without its overlay yet holds at neutral "active"). */
  tasksLoading: boolean;
  loading: boolean;
  notifyScope: NotifyScope;
  members: ChannelMember[];
  currentUserId: string;
  /** Pending consent requests (inbound + outbound) for THIS channel. */
  consentRequests: ChannelConsentRequest[];
  trustedIds: ReadonlySet<string>;
  /** Trust toggles with a write in flight (per-user, so one can't re-enable
   *  another mid-flight). */
  trustBusyIds: ReadonlySet<string>;
  /** Consent decisions with a write in flight, by request id. */
  consentBusyIds: ReadonlySet<string>;
  onSend: (body: string, opts?: SendOptions) => Promise<void>;
  onInvite: () => void;
  onSetNotifyScope: (scope: NotifyScope) => void;
  onSetToolProfile: (profile: AgentToolProfile) => void;
  onToggleTrust: (userId: string, trusted: boolean) => void;
  onDecideConsent: (id: string, decision: "allow" | "deny") => void;
  onToggleArchive: () => void;
  onToggleVisibility: () => void;
  onDelete: () => void;
  onJoin: () => void;
  onLeave: () => void;
}

/**
 * Channel detail pane: a crumb bar (name, visibility, member count, presence)
 * with the notification / settings / invite / manage actions, the first-class
 * {@link PendingRequestsPanel} (inbound approvals + outbound reviews as a
 * labelled list), a scrolling transcript that auto-sticks to the bottom, and
 * the pinned composer (or a read-only / join affordance when the caller isn't a
 * member).
 */
export function ChannelThread({
  channel,
  messages,
  tasks,
  tasksLoading,
  loading,
  notifyScope,
  members,
  currentUserId,
  consentRequests,
  trustedIds,
  trustBusyIds,
  consentBusyIds,
  onSend,
  onInvite,
  onSetNotifyScope,
  onSetToolProfile,
  onToggleTrust,
  onDecideConsent,
  onToggleArchive,
  onToggleVisibility,
  onDelete,
  onJoin,
  onLeave,
}: Props) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [notifyOpen, setNotifyOpen] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const canManage = channel.role === "owner";
  // Direct-channel rendering: the header + composer speak to the resolved peer
  // (name / avatar live from the roster), never the stored channel name/slug.
  const displayName = channelDisplayName(channel);
  const peer = channelDisplayAvatarPerson(channel);
  const peerName = channel.directPeer?.displayName ?? "your teammate";

  const memberNames = useMemo(
    () =>
      new Map(members.map((m) => [m.userId, m.displayName || m.email || "teammate"])),
    [members]
  );
  const otherMembers = useMemo(
    () => members.filter((m) => m.userId !== currentUserId),
    [members, currentUserId]
  );
  const onlineMembers = useMemo(
    () => members.filter((m) => m.agentOnline),
    [members]
  );
  // The presence strip shows EVERY member in a STABLE order (join time, then
  // userId) — never reordered by who is online, so avatars don't jump as agents
  // come and go. The online flag drives the success ring per avatar.
  const orderedMembers = useMemo(
    () =>
      [...members].sort((a, b) => {
        if (a.joinedAt !== b.joinedAt) return a.joinedAt < b.joinedAt ? -1 : 1;
        if (a.userId !== b.userId) return a.userId < b.userId ? -1 : 1;
        return 0;
      }),
    [members]
  );

  // Stick to the bottom when the transcript grows or the channel changes.
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages.length, channel.id]);

  return (
    <div className="flex min-w-0 flex-1 flex-col">
      <div className="flex h-[52px] shrink-0 items-center gap-2 border-b border-border-default px-3.5">
        {channel.isDirect ? (
          <>
            {peer && (
              <Avatar
                person={{
                  userId: peer.userId,
                  email: null,
                  displayName: peer.displayName,
                  avatarUrl: peer.avatarUrl,
                }}
                size="xs"
              />
            )}
            <span className="shrink-0 truncate text-lead font-semibold text-text-primary">
              {displayName}
            </span>
          </>
        ) : (
          <>
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
          </>
        )}
        <span className="flex-1" />

        {/* Presence: every member, stable order, ringed when their agent is online. */}
        <span className="flex shrink-0 items-center gap-1.5">
          <PresenceDot online={onlineMembers.length > 0} />
          <span className="text-caption text-text-muted">
            {onlineMembers.length > 0
              ? `${onlineMembers.length} online`
              : "No agents online"}
          </span>
          {orderedMembers.length > 0 && (
            <AvatarStack
              users={orderedMembers.map((m) => ({
                userId: m.userId,
                displayName: m.displayName || m.email || "teammate",
                avatarUrl: m.avatarUrl,
                online: m.agentOnline,
              }))}
              max={5}
            />
          )}
        </span>

        {channel.isMember && (
          <div className="relative shrink-0">
            <button
              type="button"
              onClick={() => setNotifyOpen((v) => !v)}
              aria-label="Notification settings"
              title="Notification settings"
              className="flex h-7 w-7 items-center justify-center rounded-[7px] text-text-secondary transition-colors hover:bg-surface-raised-1 hover:text-text-primary"
            >
              {notifyScope === "none" ? <BellOff size={16} /> : <Bell size={16} />}
            </button>
            <Popover
              open={notifyOpen}
              onClose={() => setNotifyOpen(false)}
              align="right"
              className="min-w-[248px]"
            >
              {NOTIFY_OPTIONS.map((option) => (
                <MenuItem
                  key={option.scope}
                  showCheck
                  active={notifyScope === option.scope}
                  description={option.description}
                  onSelect={() => {
                    setNotifyOpen(false);
                    if (option.scope !== notifyScope) onSetNotifyScope(option.scope);
                  }}
                >
                  {option.label}
                </MenuItem>
              ))}
            </Popover>
          </div>
        )}

        {channel.isMember && (
          <ChannelSettingsPopover
            channel={channel}
            otherMembers={otherMembers}
            trustedIds={trustedIds}
            trustBusyIds={trustBusyIds}
            onSetToolProfile={onSetToolProfile}
            onToggleTrust={onToggleTrust}
          />
        )}

        {/* Desktop-only: sets the responding agent's working folder. Renders
            nothing in a plain browser (feature-detected on window.dopl). */}
        {channel.isMember && <ChannelFolderControl channelId={channel.id} />}

        {/* A DM is a fixed 1:1 pair — no invite affordance (server also rejects). */}
        {channel.isMember && !channel.isDirect && (
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
                    setConfirmDelete(true);
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
      </div>

      <PendingRequestsPanel
        requests={consentRequests}
        toolProfile={channel.myAgentToolProfile ?? "full"}
        busyIds={consentBusyIds}
        onDecide={onDecideConsent}
      />

      <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto px-14 pt-6">
        <div className="mx-auto max-w-[760px]">
          {messages.length === 0 ? (
            <p className="py-10 text-center text-caption text-text-muted">
              {loading ? "Loading messages…" : "No messages yet."}
            </p>
          ) : (
            <MessageThread
              messages={messages}
              memberNames={memberNames}
              tasks={tasks}
              tasksLoading={tasksLoading}
            />
          )}
        </div>
      </div>

      {channel.isMember ? (
        <MessageComposer
          onSend={onSend}
          members={members}
          currentUserId={currentUserId}
          disabled={channel.archivedAt !== null}
          placeholder={
            channel.archivedAt
              ? "This channel is archived"
              : channel.isDirect
                ? `Message ${peerName}`
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
        title={channel.isDirect ? "Delete conversation?" : "Delete channel?"}
        description={
          channel.isDirect
            ? `Your direct message with ${peerName} will be hidden. Opening it again later brings the history back.`
            : `"${displayName}" and its messages will be removed. This can't be undone from here.`
        }
        confirmLabel="Delete"
        destructive
        onConfirm={onDelete}
      />
    </div>
  );
}

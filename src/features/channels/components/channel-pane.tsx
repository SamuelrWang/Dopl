"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Bell, BellOff, Hash, ListTodo, UserPlus } from "lucide-react";
import { cn } from "@/shared/lib/utils";
import { MenuItem, Popover } from "@/shared/ui/popover-menu";
import { Avatar, type AvatarPerson } from "@/shared/ui/avatar";
import { AvatarStack } from "@/shared/ui/avatar-stack";
import { ConfirmDialog } from "@/shared/ui/confirm-dialog";
// v3.0 vocabulary: `ChannelThread` (imported below) is the TYPE for one exchange
// inside a channel. This file's component is the whole channel detail pane, so it
// is named ChannelPane — it was called ChannelThread before the vocabulary round,
// which made one name mean two different things.
import type {
  AgentToolProfile,
  Channel,
  ChannelConsentRequest,
  ChannelMember,
  ChannelMessage,
  ChannelThread,
  NotifyScope,
} from "../types";
import {
  channelDisplayName,
  channelDisplayPeerPerson,
} from "../lib/channel-display";
import { MessageThread } from "./message-thread";
import { MessageComposer, type SendOptions } from "./message-composer";
import { ConsentCard } from "./consent-card";
import { ChannelActionsMenu } from "./channel-actions-menu";
import { ThreadPanel } from "./thread-panel";
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

/** How long a thread's grouped card keeps its navigation ring after a panel click. */
const THREAD_HIGHLIGHT_MS = 2200;

interface Props {
  channel: Channel;
  messages: ChannelMessage[];
  /** The channel's threads — the transcript's status / title overlay. */
  threads: ChannelThread[];
  /** True while the thread overlay is still loading — suppresses the status
   *  flicker (a UUID thread without its overlay yet holds at neutral "active"). */
  threadsLoading: boolean;
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
  onCloseThread: (
    threadId: string,
    outcome: "completed" | "failed",
    summary?: string
  ) => Promise<void>;
  /** Reopen a closed thread — the thread panel's control; session cards never reopen. */
  onReopenThread: (threadId: string) => Promise<void>;
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
 * Channel detail pane (ChannelPane): a crumb bar (name, visibility, member count, presence)
 * with the notification / settings / invite / manage actions, a scrolling
 * transcript that auto-sticks to the bottom, and the pinned composer (or a
 * read-only / join affordance when the caller isn't a member).
 *
 * Pending consent decisions for this channel (inbound approvals + outbound
 * reviews) ride at the END of that transcript, after the last message, so a new
 * request reads as the newest thing in the chain and scrolls with the history
 * instead of pinning a band above it.
 */
export function ChannelPane({
  channel,
  messages,
  threads,
  threadsLoading,
  loading,
  notifyScope,
  members,
  currentUserId,
  consentRequests,
  trustedIds,
  trustBusyIds,
  consentBusyIds,
  onSend,
  onCloseThread,
  onReopenThread,
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
  const [notifyOpen, setNotifyOpen] = useState(false);
  const [threadPanelOpen, setThreadPanelOpen] = useState(false);
  const [highlightedThreadId, setHighlightedThreadId] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const highlightTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const canManage = channel.role === "owner";
  // Direct-channel rendering: the header + composer speak to the resolved peer
  // (name / avatar live from the roster), never the stored channel name/slug.
  // Resolve defensively so an unresolved `directPeer` still shows a real name +
  // avatar (from the roster) rather than a bare "Direct message" placeholder.
  const displayName = channelDisplayName(channel, members, currentUserId);
  const peerPerson = channelDisplayPeerPerson(channel, members, currentUserId);
  const peerName = displayName === "Direct message" ? "your teammate" : displayName;
  // A DM always renders an avatar; when the peer is unresolved, fall back to a
  // display-name-seeded person so the Avatar's initials fallback covers it.
  const dmAvatarPerson: AvatarPerson = peerPerson ?? {
    userId: channel.id,
    email: null,
    displayName,
    avatarUrl: null,
  };

  const memberNames = useMemo(
    () =>
      new Map(members.map((m) => [m.userId, m.displayName || m.email || "teammate"])),
    [members]
  );
  // The latest `task_progress` milestone per thread, keyed by its `metadata.taskId`
  // — a pure derivation over already-loaded messages (seq-ascending), so the
  // thread panel can show each thread's most recent accomplishment with no extra
  // fetch or write (F-072-safe).
  const latestMilestone = useMemo(() => {
    const map = new Map<string, ChannelMessage>();
    for (const m of messages) {
      if (m.kind !== "task_progress") continue;
      const taskId = m.metadata.taskId;
      if (typeof taskId !== "string" || taskId.length === 0) continue;
      const existing = map.get(taskId);
      if (!existing || m.seq > existing.seq) map.set(taskId, m);
    }
    return map;
  }, [messages]);
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

  // Stick to the bottom when the transcript grows or the channel changes. A
  // newly arrived pending request is the transcript's new last row, so its
  // count is a dependency too — an inbound ask scrolls itself into view.
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages.length, consentRequests.length, channel.id]);

  // Clear the pending highlight timer on unmount / channel switch.
  useEffect(
    () => () => {
      if (highlightTimerRef.current) clearTimeout(highlightTimerRef.current);
    },
    []
  );

  // Thread-panel navigation: close the panel, ring the thread's grouped card,
  // and scroll it into view. An open thread with no grouped card has no element,
  // so the scroll is a no-op while the highlight still arms (harmless).
  function handleSelectThread(threadId: string) {
    setThreadPanelOpen(false);
    setHighlightedThreadId(threadId);
    document
      .getElementById(`session:${threadId}`)
      ?.scrollIntoView({ behavior: "smooth", block: "center" });
    if (highlightTimerRef.current) clearTimeout(highlightTimerRef.current);
    highlightTimerRef.current = setTimeout(
      () => setHighlightedThreadId(null),
      THREAD_HIGHLIGHT_MS
    );
  }

  return (
    <div className="flex min-w-0 flex-1 flex-col">
      <div className="flex h-[52px] shrink-0 items-center gap-2 border-b border-border-default px-3.5">
        {channel.isDirect ? (
          <>
            <Avatar person={dmAvatarPerson} size="xs" />
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
              onClick={() => setThreadPanelOpen((v) => !v)}
              aria-label="Threads"
              title="Threads"
              className="flex h-7 w-7 items-center justify-center rounded-[7px] text-text-secondary transition-colors hover:bg-surface-raised-1 hover:text-text-primary"
            >
              <ListTodo size={16} />
            </button>
            <Popover
              open={threadPanelOpen}
              onClose={() => setThreadPanelOpen(false)}
              align="right"
              className="w-80"
            >
              <ThreadPanel
                threads={threads}
                threadsLoading={threadsLoading}
                members={members}
                memberNames={memberNames}
                latestMilestone={latestMilestone}
                onSelectThread={handleSelectThread}
                currentUserId={currentUserId}
                onCloseThread={onCloseThread}
                onReopenThread={onReopenThread}
              />
            </Popover>
          </div>
        )}

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
        <ChannelActionsMenu
          channel={channel}
          canManage={canManage}
          onToggleVisibility={onToggleVisibility}
          onToggleArchive={onToggleArchive}
          onRequestDelete={() => setConfirmDelete(true)}
          onLeave={onLeave}
        />
      </div>

      <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto px-14 pt-6">
        <div className="mx-auto flex max-w-[760px] flex-col gap-2.5 pb-2">
          {messages.length === 0 ? (
            loading || consentRequests.length === 0 ? (
              <p className="py-10 text-center text-caption text-text-muted">
                {loading ? "Loading messages…" : "No messages yet."}
              </p>
            ) : null
          ) : (
            <MessageThread
              messages={messages}
              memberNames={memberNames}
              threads={threads}
              threadsLoading={threadsLoading}
              currentUserId={currentUserId}
              highlightedThreadId={highlightedThreadId}
              onCloseThread={onCloseThread}
            />
          )}

          {/* Pending decisions live at the bottom of the chain, in the scroller,
              so an inbound ask reads as the newest row. A decided or expired
              request drops out of `consentRequests` upstream and leaves here. */}
          {consentRequests.length > 0 && (
            <section
              aria-label="Pending requests"
              className="flex flex-col gap-2.5"
            >
              {consentRequests.map((request) => (
                <ConsentCard
                  key={request.id}
                  request={request}
                  toolProfile={channel.myAgentToolProfile ?? "full"}
                  busy={consentBusyIds.has(request.id)}
                  onAllow={() => onDecideConsent(request.id, "allow")}
                  onDeny={() => onDecideConsent(request.id, "deny")}
                />
              ))}
            </section>
          )}
        </div>
      </div>

      {channel.isMember ? (
        <MessageComposer
          onSend={onSend}
          members={members}
          currentUserId={currentUserId}
          isDirect={channel.isDirect}
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

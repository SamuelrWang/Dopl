"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Hash, PanelRight, UserPlus } from "lucide-react";
import { cn } from "@/shared/lib/utils";
import { Avatar, type AvatarPerson } from "@/shared/ui/avatar";
import { AvatarStack } from "@/shared/ui/avatar-stack";
import { ConfirmDialog } from "@/shared/ui/confirm-dialog";
// ⚠ `ChannelThread` (imported below) is the TYPE for one exchange inside a
// channel. This component is the whole channel detail pane, hence ChannelPane —
// do not rename it back to ChannelThread; that made one name mean two things.
import type {
  AgentToolProfile,
  Channel,
  ChannelConsentRequest,
  ChannelMember,
  ChannelMessage,
  ChannelThread,
} from "../types";
import {
  channelDisplayName,
  channelDisplayPeerPerson,
} from "../lib/channel-display";
import { useChannelAgents } from "../hooks/use-channel-agents";
import { ChannelTranscript } from "./channel-transcript";
import { MessageComposer, type SendOptions } from "./message-composer";
import { LaunchPanel } from "./launch-panel";
import { ChannelActionsMenu } from "./channel-actions-menu";
import { ChannelSettingsPopover } from "./channel-settings-popover";
import { ChannelFolderControl } from "./channel-folder-control";
import { PresenceDot } from "./address-picker";
import { RoomsSidebar } from "./rooms-sidebar";

interface Props {
  channel: Channel;
  messages: ChannelMessage[];
  /** The channel's threads — the rooms column's list. ⚠ No longer a transcript
   *  overlay: the session card that consumed it is deleted (Phase 5). */
  threads: ChannelThread[];
  /** ⚠ Suppresses status flicker — a UUID thread with no overlay yet holds at
   *  neutral "active". */
  threadsLoading: boolean;
  loading: boolean;
  members: ChannelMember[];
  currentUserId: string;
  /** Pending consent requests (inbound + outbound) for THIS channel. */
  consentRequests: ChannelConsentRequest[];
  trustedIds: ReadonlySet<string>;
  /** Trust toggles with a write in flight — per-user, so one cannot re-enable
   *  another mid-flight. */
  trustBusyIds: ReadonlySet<string>;
  /** Consent decisions with a write in flight, by request id. */
  consentBusyIds: ReadonlySet<string>;
  onSend: (body: string, opts?: SendOptions) => Promise<void>;
  // ⚠ `onCloseThread` / `onReopenThread` were props here until thread closing
  // was removed (wiring plan Phase 4, 2026-08-18). Nothing below the pane
  // settles a thread any more.
  onInvite: () => void;
  onSetToolProfile: (profile: AgentToolProfile) => void;
  /** Tool-profile write in flight — the Tools panel goes inert, like the
   *  permission arm's two panels. */
  toolProfileBusy: boolean;
  onToggleTrust: (userId: string, trusted: boolean) => void;
  onDecideConsent: (id: string, decision: "allow" | "deny") => void;
  onToggleArchive: () => void;
  onToggleVisibility: () => void;
  onDelete: () => void;
  onJoin: () => void;
  onLeave: () => void;
}

/**
 * Channel detail pane: crumb bar (name, visibility, topic, presence strip) with
 * settings / invite / manage actions, a transcript that auto-sticks to the
 * bottom, and the pinned composer (or a read-only / join affordance).
 *
 * ⚠ Pending consent decisions ride at the END of the transcript, after the last
 * message, so a new request reads as the newest thing in the chain and scrolls
 * with history rather than pinning a band above it.
 */
export function ChannelPane({
  channel,
  messages,
  threads,
  threadsLoading,
  loading,
  members,
  currentUserId,
  consentRequests,
  trustedIds,
  trustBusyIds,
  consentBusyIds,
  onSend,
  onInvite,
  onSetToolProfile,
  toolProfileBusy,
  onToggleTrust,
  onDecideConsent,
  onToggleArchive,
  onToggleVisibility,
  onDelete,
  onJoin,
  onLeave,
}: Props) {
  const [roomsOpen, setRoomsOpen] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [confirmLeave, setConfirmLeave] = useState(false);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const canManage = channel.role === "owner";
  // Historical agent roster, scoped to this channel. Its only remaining consumer
  // is ATTRIBUTION — an old message stamped `author_agent_id` still renders its
  // handle. Skipped for a non-member (the route would refuse).
  const agents = useChannelAgents(channel.id, channel.workspaceId, {
    enabled: channel.isMember,
  });
  // ⚠ Header + composer speak to the resolved peer (name/avatar LIVE from the
  // roster), never the stored channel name/slug. Resolved defensively so an
  // unresolved `directPeer` still shows a real name rather than a placeholder.
  const displayName = channelDisplayName(channel, members, currentUserId);
  const peerPerson = channelDisplayPeerPerson(channel, members, currentUserId);
  const peerName = displayName === "Direct message" ? "your teammate" : displayName;
  // A DM always renders an avatar; unresolved peers fall back to a
  // display-name-seeded person so Avatar's initials fallback covers it.
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
  const otherMembers = useMemo(
    () => members.filter((m) => m.userId !== currentUserId),
    [members, currentUserId]
  );
  const onlineMembers = useMemo(
    () => members.filter((m) => m.agentOnline),
    [members]
  );
  // ⚠ EVERY member in a STABLE order (join time, then userId) — never reordered
  // by who is online, or avatars jump as agents come and go. The online flag
  // drives the per-avatar ring.
  const orderedMembers = useMemo(
    () =>
      [...members].sort((a, b) => {
        if (a.joinedAt !== b.joinedAt) return a.joinedAt < b.joinedAt ? -1 : 1;
        if (a.userId !== b.userId) return a.userId < b.userId ? -1 : 1;
        return 0;
      }),
    [members]
  );

  // Stick to the bottom as the transcript grows or the channel changes. ⚠ A new
  // pending request is the last row, so its count is a dependency too.
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages.length, consentRequests.length, channel.id]);

  // Thread navigation: scroll the thread's first transcript row into view.
  // ⚠ THE TRANSIENT RING WENT WITH THE SESSION CARD (wiring plan Phase 5,
  // 2026-08-18) — it was the card's own treatment, and there is no longer one
  // element that IS the exchange. The `session:<threadId>` anchor survived and
  // now rides that first row, so this navigation still lands; a thread with no
  // row in the loaded page has no element and the scroll no-ops, exactly as
  // before.
  function handleSelectThread(threadId: string) {
    document
      .getElementById(`session:${threadId}`)
      ?.scrollIntoView({ behavior: "smooth", block: "center" });
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

        {/* The rooms column is OPTIONAL — collapsed by default, because a
            channel running one or two threads reads fine without it. */}
        {channel.isMember && (
          <button
            type="button"
            onClick={() => setRoomsOpen((v) => !v)}
            aria-label="Rooms"
            aria-pressed={roomsOpen}
            title={roomsOpen ? "Hide rooms" : "Show rooms"}
            className={cn(
              "flex h-7 w-7 shrink-0 items-center justify-center rounded-[7px] text-text-secondary transition-colors hover:text-text-primary",
              /* Open = the raised white face; the hover tint belongs to the
                 resting state only — a `bg-*` utility outranks the kit layer
                 and would flatten `.raised-tab`'s gradient. */
              roomsOpen ? "raised-tab text-text-primary" : "hover:bg-surface-raised-1"
            )}
          >
            <PanelRight size={16} />
          </button>
        )}

        {channel.isMember && (
          <ChannelSettingsPopover
            channel={channel}
            otherMembers={otherMembers}
            trustedIds={trustedIds}
            trustBusyIds={trustBusyIds}
            onSetToolProfile={onSetToolProfile}
            toolProfileBusy={toolProfileBusy}
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
          onRequestLeave={() => setConfirmLeave(true)}
        />
      </div>

      {/* ⚠ THE SESSION PILLS BAR AND THE THREADS BUTTON STOOD HERE and were
          DELETED (wiring plan Phase 5, 2026-08-18). Both were session surfaces
          on a page that is itself deleted at the v2 cutover (Phase 12); the
          operator watches their own agents in the v2 right panel's AGENTS TAB
          now, over the same desktop projection the pills read
          (`channels-v2/agents-model.ts`), with pause / end on the agent. The
          thread popover went with `thread-panel.tsx`, whose row actions were the
          close/reopen controls Phase 4 removed. */}
      {/* Body row: the conversation column, plus the optional rooms column. */}
      <div className="flex min-h-0 flex-1">
        <div className="flex min-w-0 flex-1 flex-col">
          <div
            ref={scrollRef}
            className="min-h-0 flex-1 overflow-y-auto px-14 pt-6"
          >
            <div className="mx-auto flex max-w-[760px] flex-col gap-2.5 pb-2">
              {messages.length === 0 ? (
                loading || consentRequests.length === 0 ? (
                  <p className="py-10 text-center text-caption text-text-muted">
                    {loading ? "Loading messages…" : "No messages yet."}
                  </p>
                ) : null
              ) : (
                <ChannelTranscript
                  messages={messages}
                  memberNames={memberNames}
                  currentUserId={currentUserId}
                  agents={agents}
                />
              )}

              {/* Pending decisions live at the bottom of the chain, in the
                  scroller, so an inbound ask reads as the newest row. A decided
                  or expired request drops out of `consentRequests` upstream and
                  leaves here. */}
              {consentRequests.length > 0 && (
                <section
                  aria-label="Pending requests"
                  className="flex flex-col gap-2.5"
                >
                  {consentRequests.map((request) => (
                    <LaunchPanel
                      key={request.id}
                      request={request}
                      busy={consentBusyIds.has(request.id)}
                      onLaunch={() => onDecideConsent(request.id, "allow")}
                      onDecline={() => onDecideConsent(request.id, "deny")}
                    />
                  ))}
                </section>
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
        </div>

        {channel.isMember && roomsOpen && (
          <RoomsSidebar
            threads={threads}
            threadsLoading={threadsLoading}
            onSelectThread={handleSelectThread}
            onCollapse={() => setRoomsOpen(false)}
          />
        )}
      </div>

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
        onConfirm={onDelete}
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
        onConfirm={onLeave}
      />
    </div>
  );
}

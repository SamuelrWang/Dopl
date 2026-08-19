"use client";

/**
 * Channels v2 — the right panel's INFO tab: channel metadata, the Tags
 * (mentions) disclosure, Linked threads, the activity heatmap and the roster.
 *
 * WIRED: Main info (creator / created / status / thread count) off the channel
 * row and its thread list, MEMBERS off `use-channel-members` with presence
 * computed client-side over the 90s window, and the TAGS inbox off
 * `use-channel-mentions` (Phase 6).
 *
 * HARDCODED — no backing data yet (Samuel 2026-08-18): Linked threads and the
 * activity heatmap keep the mock's UI and are wired later as their own work.
 * Each site carries the marker where it renders.
 */

import { useState } from "react";
import {
  Calendar,
  ChevronDown,
  ChevronRight,
  CircleDot,
  Hash,
  ListChecks,
  ListFilter,
  Tag,
  UserPlus,
  UserRound,
} from "lucide-react";
import { Avatar } from "@/shared/ui/avatar";
import { AvatarWithPresence } from "@/shared/ui/avatar-with-presence";
import { cn } from "@/shared/lib/utils";
import { formatShortDate } from "@/shared/lib/format-time";
import {
  CountBadge,
  IconButton,
  MetaRow,
  PanelHeading,
  RolePill,
  StatusPill,
} from "./bits";
import { MentionsList } from "./mentions-list";
import {
  HARDCODED_LINKED_THREADS,
  HARDCODED_THREAD_ACTIVITY,
} from "./fixtures";
import { isPresent, memberPerson, type AuthorIndex } from "./view-model";
import { memberLabel } from "../../lib/channel-display";
import type { Channel, ChannelMember, ChannelMention } from "../../types";

/** Heatmap shades, low → high. Opacity steps on the success token: the palette
 *  carries one green, so density is expressed as strength, not as hue. */
const ACTIVITY_SHADE = [
  "bg-success/10",
  "bg-success/25",
  "bg-success/45",
  "bg-success/70",
  "bg-success",
] as const;

export function InfoTab({
  channel,
  channelName,
  members,
  threadCount,
  mentions,
  mentionsTruncated,
  mentionsLoading,
  index,
  onOpenMention,
  onMarkAllMentionsRead,
}: {
  channel: Channel;
  channelName: string;
  members: ChannelMember[];
  threadCount: number;
  /** MY mentions in this channel, server-ordered. */
  mentions: ChannelMention[];
  mentionsTruncated: boolean;
  mentionsLoading: boolean;
  index: AuthorIndex;
  onOpenMention: (mention: ChannelMention) => void;
  onMarkAllMentionsRead: () => void;
}) {
  // The Tags disclosure is the ONE expandable row in Main info; its open state
  // is nobody else's business, so it stays here.
  const [tagsOpen, setTagsOpen] = useState(false);
  // ⚠ LIVE UNREAD, computed HERE from the projection's own `read` flag — one
  // derivation for the badge and the list, so they cannot disagree (wiring plan
  // Phase 6, decision 3). Never a server-side count.
  const unreadCount = mentions.filter((m) => !m.read).length;

  const creator = members.find((m) => m.userId === channel.createdBy) ?? null;
  const online = members.filter((m) => isPresent(m));
  const offline = members.filter((m) => !isPresent(m));

  return (
    <div className="min-h-0 flex-1 overflow-y-auto pb-6">
      <PanelHeading title="Main info" />
      <div className="px-2">
        <MetaRow icon={UserRound} label="Creator">
          {creator ? (
            <>
              <Avatar
                person={memberPerson(creator)}
                size="xs"
                className="h-[20px] w-[20px] text-micro"
              />
              <span className="text-body text-text-primary">
                {memberLabel(creator)}
              </span>
            </>
          ) : (
            // A creator who has left the workspace has no roster row. The id is
            // not a name, so the row says it does not know rather than
            // rendering a uuid at somebody.
            <span className="text-body text-text-muted">Not in this channel</span>
          )}
        </MetaRow>
        <MetaRow icon={Calendar} label="Date of creation">
          <span className="text-body text-text-primary">
            {formatShortDate(channel.createdAt)}
          </span>
        </MetaRow>
        <MetaRow icon={CircleDot} label="Status">
          {channel.archivedAt ? (
            <span className="text-body text-text-muted">Archived</span>
          ) : (
            <StatusPill label="Active" />
          )}
        </MetaRow>
        {/* The mentions inbox — label kept "Tags" from the reference design.
            WIRED (Phase 6): the list is the real projection and the count is
            LIVE UNREAD over it, not a total. The chevron flips open. */}
        <button
          type="button"
          onClick={() => setTagsOpen((open) => !open)}
          aria-expanded={tagsOpen}
          className="flex h-10 w-full items-center gap-2 rounded-[8px] px-2 text-left transition-colors hover:bg-surface-raised-1"
        >
          <Tag size={14} className="shrink-0 text-text-muted" />
          <span className="text-small text-text-secondary">Tags</span>
          <span className="flex-1" />
          <span
            className={cn(
              "text-body",
              unreadCount > 0 ? "font-semibold text-link" : "text-text-primary"
            )}
          >
            {unreadCount}
          </span>
          {tagsOpen ? (
            <ChevronDown size={13} className="shrink-0 text-text-disabled" />
          ) : (
            <ChevronRight size={13} className="shrink-0 text-text-disabled" />
          )}
        </button>
        {tagsOpen && (
          <MentionsList
            mentions={mentions}
            truncated={mentionsTruncated}
            loading={mentionsLoading}
            channelName={channelName}
            index={index}
            onOpenMention={onOpenMention}
            onMarkAllRead={onMarkAllMentionsRead}
          />
        )}
        {/* WIRED: the channel's thread count, off the same bounded list the
            Threads tab renders. */}
        <MetaRow icon={ListChecks} label="Threads">
          <span className="text-body text-text-primary">{threadCount}</span>
        </MetaRow>
      </div>

      <PanelHeading title="Linked threads" />
      <div className="flex flex-col gap-px px-2">
        {/* HARDCODED — no backing data yet (Samuel 2026-08-18). A thread belongs
            to one channel and links to nothing; there is no relation to read. */}
        {HARDCODED_LINKED_THREADS.map(({ label, badge }) => (
          <button
            key={label}
            type="button"
            className="flex h-[34px] w-full items-center gap-2 rounded-[8px] px-2 text-left text-small text-text-secondary transition-colors hover:bg-surface-raised-1 hover:text-text-primary"
          >
            <Hash size={14} className="shrink-0 text-text-muted" />
            <span className="truncate">{label}</span>
            {badge !== undefined && <CountBadge value={badge} />}
          </button>
        ))}
      </div>

      <PanelHeading title="Thread activity" />
      {/* HARDCODED — no backing data yet (Samuel 2026-08-18). The
          `channel_tasks_activity` view carries ONE timestamp per thread, not a
          per-slice histogram; rendering zeros would assert quiet weeks nobody
          measured. */}
      <div
        role="img"
        aria-label="Thread activity over the last 24 slices"
        className="flex flex-wrap gap-1 px-3.5 pt-1"
      >
        {HARDCODED_THREAD_ACTIVITY.map((level, i) => (
          <span
            key={i}
            className={cn("h-3.5 w-3.5 rounded-[4px]", ACTIVITY_SHADE[level])}
          />
        ))}
      </div>

      <PanelHeading
        title="Members"
        trailing={
          <>
            <span className="text-caption text-text-muted">{members.length}</span>
            <span className="flex-1" />
            <IconButton icon={UserPlus} label="Add member" size={14} className="h-6 w-6" />
            <IconButton icon={ListFilter} label="Filter members" size={14} className="h-6 w-6" />
          </>
        }
      />
      <div className="flex flex-col gap-px px-2">
        {online.map((member) => (
          <MemberRow key={member.userId} member={member} online />
        ))}
        {offline.length > 0 && (
          <p className="px-2 pb-1 pt-3 text-label font-semibold uppercase tracking-wide text-text-muted">
            Offline
          </p>
        )}
        {offline.map((member) => (
          <MemberRow key={member.userId} member={member} online={false} />
        ))}
        {members.length === 0 && (
          <p className="px-2 py-2 text-caption text-text-muted">
            No members in this channel.
          </p>
        )}
      </div>
    </div>
  );
}

/**
 * One roster row. Presence is `AvatarWithPresence`'s ring — the kit's recipe,
 * never a standalone dot — and the boolean is CLIENT-SIDE arithmetic over
 * `lastSeenAt` (INVARIANTS §7), so a stale roster reads OFFLINE rather than
 * falsely online.
 *
 * The subline is the member's email, not a job title: the model has no such
 * field, and the chip beside it states the one role a channel roster actually
 * carries (INVARIANTS §5).
 */
function MemberRow({ member, online }: { member: ChannelMember; online: boolean }) {
  return (
    <div
      className={cn(
        "flex h-[46px] items-center gap-2.5 rounded-[8px] px-2",
        !online && "opacity-60"
      )}
    >
      <AvatarWithPresence
        person={memberPerson(member)}
        online={online}
        size="sm"
        title={online ? "Agent listening" : "Agent offline"}
      />
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="truncate text-body font-semibold text-text-primary">
          {member.displayName ?? member.email ?? "Member"}
        </span>
        {member.email && (
          <span className="truncate text-caption text-text-muted">{member.email}</span>
        )}
      </span>
      <RolePill owner={member.role === "owner"} />
    </div>
  );
}

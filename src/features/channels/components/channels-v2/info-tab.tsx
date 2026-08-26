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
import { cn } from "@/shared/lib/utils";
import { formatShortDate } from "@/shared/lib/format-time";
import {
  CountBadge,
  IconButton,
  MetaRow,
  MetaRowDivider,
  PanelHeading,
  StatusPill,
} from "./bits";
import { MemberRoster } from "./member-roster";
import { ActivityCells } from "./thread-activity";
import { MentionsList } from "./mentions-list";
import {
  HARDCODED_LINKED_THREADS,
  HARDCODED_THREAD_ACTIVITY,
} from "./fixtures";
import { memberPerson, type AuthorIndex } from "./view-model";
import { memberLabel } from "../../lib/channel-display";
import type { Channel, ChannelMember, ChannelMention } from "../../types";

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
        <MetaRowDivider />
        <MetaRow icon={Calendar} label="Date of creation">
          <span className="text-body text-text-primary">
            {formatShortDate(channel.createdAt)}
          </span>
        </MetaRow>
        <MetaRowDivider />
        <MetaRow icon={CircleDot} label="Status">
          {channel.archivedAt ? (
            <span className="text-body text-text-muted">Archived</span>
          ) : (
            <StatusPill label="Active" />
          )}
        </MetaRow>
        <MetaRowDivider />
        {/* The mentions inbox — label kept "Tags" from the reference design.
            WIRED (Phase 6): the list is the real projection and the count is
            LIVE UNREAD over it, not a total. The chevron flips open. */}
        <button
          type="button"
          onClick={() => setTagsOpen((open) => !open)}
          aria-expanded={tagsOpen}
          className="flex h-9 w-full items-center gap-2 rounded-[8px] px-2 text-left transition-colors hover:bg-surface-raised-1"
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
        <MetaRowDivider />
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
      {/* ⚠ STILL HARDCODED HERE, AND THE ACCOUNT SURFACE'S IS NOT (F-316,
          2026-08-25). /home feeds the identical squares from a real
          channel-scoped daily series; this page would need that read threaded
          down through `channel-surface-data.ts` and would pay 31 counted bins
          on every channel selection, which is a cost nobody has asked for yet.
          ⚠ The SQUARES are now `thread-activity.tsx › ActivityCells` and the
          ramp is its `ACTIVITY_SHADE`, so the two strips cannot look different
          while only one of them is wired. What is fixture here is the LEVELS
          and nothing else. */}
      <ActivityCells
        levels={HARDCODED_THREAD_ACTIVITY}
        label="Thread activity over the last 31 slices"
      />

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
      {/* ⚠ THE ROSTER IS `member-roster.tsx` SINCE 2026-08-25 — the same
          component /home's Info tab renders. It was module-private here, which
          is how the account surface came to have a roster of its own. */}
      <MemberRoster members={members} emptyLine />
    </div>
  );
}

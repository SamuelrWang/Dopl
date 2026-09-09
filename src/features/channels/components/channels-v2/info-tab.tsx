"use client";

/**
 * Channels v2 — the right panel's INFO tab: channel metadata, the Tags
 * (mentions) disclosure, Linked threads, the activity heatmap and the roster.
 *
 * WIRED: channel info (creator / created / status / thread count) off the channel
 * row and its thread list, MEMBERS off `use-channel-members` (presence is the
 * server's verdict — `view-model.ts › isPresentForViewer`, 2026-09-08), the TAGS
 * inbox off `use-channel-mentions` (Phase 6), and the activity strip since
 * 2026-09-05 (F-316).
 *
 * HARDCODED — no backing data yet (Samuel 2026-08-18): Linked threads only, and
 * the site carries the marker where it renders.
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
import { ThreadActivityStrip, type ActivityBin } from "./thread-activity";
import { MentionsList } from "./mentions-list";
import { HARDCODED_LINKED_THREADS } from "./fixtures";
import { memberPerson, type AuthorIndex } from "./view-model";
import { memberLabel } from "../../lib/channel-display";
import type { Channel, ChannelMember, ChannelMention } from "../../types";

export function InfoTab({
  channel,
  channelName,
  activityBins = [],
  activityLoading = false,
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
  /** Measured messages-per-day, host-mounted. Empty renders no strip. */
  activityBins?: readonly ActivityBin[];
  activityLoading?: boolean;
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
  // The Tags disclosure is the ONE expandable row here; its open state is nobody
  // else's business.
  const [tagsOpen, setTagsOpen] = useState(false);
  // ⚠ LIVE UNREAD, computed HERE from the projection's own `read` flag — one
  // derivation for the badge and the list, so they cannot disagree (wiring plan
  // Phase 6, decision 3).
  const unreadCount = mentions.filter((m) => !m.read).length;

  const creator = members.find((m) => m.userId === channel.createdBy) ?? null;

  return (
    <div className="min-h-0 flex-1 overflow-y-auto pb-6">
      {/* ⚠ "Channel info", NOT "Main info" (Samuel, 2026-09-05): the old title
          said where the block sat rather than what it was about. */}
      <PanelHeading title="Channel info" />
      <div className="px-2">
        {/* ⚠ FIRST, ABOVE CREATOR — the subject before its facts. ⚠ IT IS
            `channelName`, THE DERIVED ONE, never `channel.name`: a 1:1 is titled
            after the other member (`peerNamedHeader` decides it, upstream), so the
            stored column would name a DM after nobody. */}
        {/* ⚠ AT EVERY WIDTH (Samuel, 2026-09-05, second ruling): the header above
            the CHAT is fine and the name is ALSO a field of this card, always. The
            duplicate he reported was a title inside the /home pane
            (`apps/desktop-ui › person-info-tab.tsx`). */}
        <MetaRow icon={Hash} label="Name">
          <span className="truncate text-body text-text-primary">
            {channelName}
          </span>
        </MetaRow>
        <MetaRowDivider />
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
            // A creator who left the workspace has no roster row, and an id is
            // not a name — so the row says it does not know.
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
            WIRED (Phase 6): the count is LIVE UNREAD over the list, not a total. */}
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
        {/* The channel's thread count, off the same bounded list the Threads tab
            renders. */}
        <MetaRow icon={ListChecks} label="Threads">
          <span className="text-body text-text-primary">{threadCount}</span>
        </MetaRow>
      </div>

      <PanelHeading title="Linked threads" />
      <div className="flex flex-col gap-px px-2">
        {/* HARDCODED — no backing data yet (Samuel 2026-08-18): a thread belongs
            to one channel and links to nothing, so there is no relation to read. */}
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

      {/* ⚠ THE LABEL FOLLOWS THE SURFACE (Samuel, 2026-09-05): this tab is the
          CHANNEL's info, so the strip counts the channel. */}
      <PanelHeading title="Channel activity" />
      {/* ⚠ **WIRED 2026-09-05 — F-316 CLOSED.** Samuel accepted the price (31
          counted bins per channel selection, threaded down through
          `channel-surface-data.ts`); the series is keyed by PATH, so re-selection
          is a cache hit rather than a re-count.
          ⚠ NO NEW ENDPOINT AND NO NEW INDEX: the same
          `overview-series?metric=messages&channelId=` the account surface has fed
          these identical squares from since 2026-08-25.
          ⚠ THE STRIP DECIDES WHAT NOTHING LOOKS LIKE, not this file: it renders
          NOTHING while the read is in flight, because an empty well means a
          MEASURED zero. */}
      <ThreadActivityStrip
        bins={activityBins}
        loading={activityLoading}
        metricLabel="Messages"
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
      {/* ⚠ THE ROSTER IS `member-roster.tsx` SINCE 2026-08-25 — the same component
          /home's Info tab renders. It was module-private here, which is how the
          account surface came to have a roster of its own. */}
      {/* ⚠ `index.currentUserId` IS THE VIEWER, the id this surface already holds —
          no second resolution (2026-09-08; `view-model.ts › isPresentForViewer`). */}
      <MemberRoster
        members={members}
        emptyLine
        viewerUserId={index.currentUserId}
      />
    </div>
  );
}

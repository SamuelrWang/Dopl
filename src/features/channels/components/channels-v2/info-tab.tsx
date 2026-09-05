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
      {/* ⚠ "Channel info", NOT "Main info" (Samuel, 2026-09-05). The old title
          said where the block sat rather than what it was about, which is the
          same complaint the NAME row below answers: this pane is about ONE
          channel and never said which. */}
      <PanelHeading title="Channel info" />
      <div className="px-2">
        {/* ⚠ FIRST, ABOVE CREATOR — the subject before its facts, and the row
            the pane was missing. ⚠ IT IS `channelName`, THE DERIVED ONE, never
            `channel.name`: a 1:1 is titled after the other member
            (`peerNamedHeader` decides it, upstream), so reading the stored
            column here would name a DM after nobody. */}
        {/* ⚠ AT EVERY WIDTH (Samuel, 2026-09-05, second ruling). This row was briefly
            gated to the single-column face on the theory that the chat header above
            the transcript already named the channel; Samuel's ruling is that the
            header above the CHAT is fine and the name is ALSO a field of this card,
            always. The duplicate he had reported was a title inside the /home pane
            (`apps/desktop-ui › person-info-tab.tsx`), a different composition. */}
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

      {/* ⚠ THE LABEL FOLLOWS THE SURFACE (Samuel, 2026-09-05). This tab is the
          CHANNEL's info, so the strip counts the channel; a thread's own strip
          says "Thread activity" on the thread's tab. The heading said "Thread"
          here while measuring nothing at all, which is two wrongs that hid each
          other. */}
      <PanelHeading title="Channel activity" />
      {/* ⚠ **WIRED 2026-09-05 — F-316 CLOSED.** This block read "STILL HARDCODED
          HERE, AND THE ACCOUNT SURFACE'S IS NOT", and named the price: the read
          threaded down through `channel-surface-data.ts`, 31 counted bins per
          channel selection, "a cost nobody has asked for yet". Samuel asked, and
          accepted the price with the query cache carrying it — the series is
          keyed by PATH, so the channel id is in the key and re-selection is a
          cache hit rather than a re-count.
          ⚠ NO NEW ENDPOINT AND NO NEW INDEX: it is the same
          `overview-series?metric=messages&channelId=` the account surface has
          fed these identical squares from since 2026-08-25.
          ⚠ THE STRIP DECIDES WHAT NOTHING LOOKS LIKE, not this file: it renders
          NOTHING while the read is in flight, because an empty well here means a
          MEASURED zero and painting 31 of them would state a quiet month the
          server has not answered for. */}
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
      {/* ⚠ THE ROSTER IS `member-roster.tsx` SINCE 2026-08-25 — the same
          component /home's Info tab renders. It was module-private here, which
          is how the account surface came to have a roster of its own. */}
      <MemberRoster members={members} emptyLine />
    </div>
  );
}

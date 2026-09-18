"use client";

/**
 * **THE CHANNEL RECORD'S INFO TAB — THE ONE BODY, ON EVERY HOST.** Channel
 * metadata, the mentions inbox, the activity strip and the roster.
 *
 * 🔒 /home had a second one until wave 1A (2026-09-17): 402 lines composing the
 * same ladder out of the same leaves through the body-REPLACING `infoTab` slot,
 * which had already dropped four things the surface paid for — the mentions
 * section, the header write, the activity strip, and the viewer id that made
 * the operator read as OFFLINE in their own channel (F-723). A host may now
 * only ADD (`channel-surface-contract.ts › ChannelInfoExtras`).
 *
 * ⚠ `mentionsLayout` is TWO RULED FACES OVER ONE BRANCH, not a fork (Samuel,
 * 2026-09-15) — the capability's own docblock carries the ruling.
 * ⚠ IT READS NOTHING ITSELF. Every fact below is `channel-surface-data.ts`,
 * mounted once by the HOST (INVARIANTS §7).
 */

import type { ReactNode } from "react";
import { MetaRowDivider, PanelHeading } from "./bits";
import { InfoTabCard } from "./info-tab-card";
import type { ChannelHeaderEdit } from "./info-inline-edit";
import type { ChannelInfoCardEdit } from "./info-card-rows";
import { MemberRoster } from "./member-roster";
import { ThreadActivityStrip, type ActivityBin } from "./thread-activity";
import { MentionsDisclosure, type MentionsBundle } from "./mentions-disclosure";
import { MentionsList } from "./mentions-list";
import type { AuthorIndex } from "./view-model";
import type {
  ChannelInfoExtras,
  MentionsLayout,
} from "./channel-surface-contract";
import type { Channel, ChannelMember, ChannelMention } from "../types";

export function InfoTab({
  channel,
  channelName,
  activityBins = [],
  activityLoading = false,
  members,
  mentions,
  mentionsTruncated,
  mentionsLoading,
  mentionsLayout = "disclosure",
  index,
  onOpenMention,
  onMarkAllMentionsRead,
  headerEdit,
  infoCardEdit,
  rosterEmptyLine = true,
  membersAction,
  extras,
}: {
  channel: Channel;
  channelName: string;
  /** Measured messages-per-day, host-mounted. Empty renders no strip. */
  activityBins?: readonly ActivityBin[];
  activityLoading?: boolean;
  members: ChannelMember[];
  /** MY mentions in this channel, server-ordered. */
  mentions: ChannelMention[];
  mentionsTruncated: boolean;
  mentionsLoading: boolean;
  /** WHICH RULED MENTIONS FACE — `ChannelSurfaceCapabilities.mentionsLayout`
   *  carries the ruling. Default is the workspace page's collapsed row. */
  mentionsLayout?: MentionsLayout;
  index: AuthorIndex;
  onOpenMention: (mention: ChannelMention) => void;
  onMarkAllMentionsRead: () => void;
  /**
   * CLICK-TO-EDIT NAME + DESCRIPTION (Samuel, 2026-09-16). ABSENT is the display
   * face and the default, so a host that has not wired the write renders exactly
   * what this tab rendered before.
   */
  headerEdit?: ChannelHeaderEdit;
  /**
   * THE CURATED `channels.info_card` ROWS' WRITE (Samuel's ruling R-19,
   * 2026-09-17).
   * ⚠ ABSENT means the rows are not drawn AT ALL, not drawn inert: each row's
   * value is the edit target and carries a hover ×, so an unwired host would
   * ship two dead controls per row (INVARIANTS §5) — and a × that does not
   * remove reads as data loss.
   */
  infoCardEdit?: ChannelInfoCardEdit;
  /**
   * 🔒 "No members in this channel." — true on a workspace channel, never on a
   * container the viewer is inside. Default on.
   * ⚠ DERIVED, NOT A NEW FLAG (`surface-info-panel.tsx`): the hosts that pass
   * `memberManagement: false` are exactly the ones whose only door in is a link
   * the reader claimed, so the sentence could only flash falsely there.
   */
  rosterEmptyLine?: boolean;
  /**
   * 🔒 THE Members HEADING'S ONE CONTROL — Add member (F-721 RESOLVED, Samuel
   * 2026-09-17, taking R-46's option (b) after all).
   * ⚠ INJECTED, NOT BUILT HERE, for `info-panel.tsx › settings`'s reason: it is
   * write-bearing and this body fetches nothing (INVARIANTS §7).
   * `surface-info-panel.tsx` owns the dialog; this file owns where it sits.
   * ⚠ ABSENT IS NOT "DISABLED" — a host with no membership to change passes
   * nothing and the heading reads the way it has since R-46: the count alone.
   * ⚠ There is no "Filter members" and there is not going to be (R-46).
   */
  membersAction?: ReactNode;
  /** WHAT THE HOST ADDS — named regions, never a body
   *  (`channel-surface-contract.ts › ChannelInfoExtras`). */
  extras?: ChannelInfoExtras;
}) {
  // ONE BUNDLE, BOTH FACES: the mentions list and the roster resolve authors
  // and the viewer from the SURFACE's one index, never two.
  const bundle: MentionsBundle = {
    mentions,
    truncated: mentionsTruncated,
    loading: mentionsLoading,
    index,
    onOpen: onOpenMention,
    onMarkAllRead: onMarkAllMentionsRead,
  };

  return (
    <div className="min-h-0 flex-1 overflow-y-auto pb-6">
      {/* ⚠ "Channel info", not "Main info", and NO NAME HEADING above the card
          (Samuel, 2026-09-05): the name is the card's first ROW — the subject
          before its facts — not a title floating over it. */}
      <PanelHeading title="Channel info" />
      <div className="px-2">
        <InfoTabCard
          channel={channel}
          channelName={channelName}
          members={members}
          headerEdit={headerEdit}
          infoCardEdit={infoCardEdit}
        />
        {/* THE COLLAPSED FACE — a row INSIDE the card, with the unread badge. */}
        {mentionsLayout === "disclosure" && (
          <>
            <MetaRowDivider />
            <MentionsDisclosure channelName={channelName} bundle={bundle} />
          </>
        )}
        {/* ⚠ The THREADS-COUNT row stood here and is deleted (Samuel's ruling
            R-22, 2026-09-17): the Threads tab already badges that number one row
            above, and a badge attached to the thing it counts is the one to keep. */}
      </div>

      {/* ⚠ "Linked threads" stood here and is deleted (Samuel's ruling R-45,
          2026-09-17) — two hardcoded rows with no `onClick` and no relation
          behind them. Reviving the idea means a schema answer first. */}

      {/* ⚠ The label follows the surface (Samuel, 2026-09-05): this tab is the
          CHANNEL's info, so the strip counts the channel. Wired 2026-09-05
          (F-316) off the same `overview-series?metric=messages&channelId=` the
          account surface already used — no new endpoint, no new index.
          ⚠ THE STRIP decides what nothing looks like, not this file: it draws
          nothing in flight, because an empty well means a MEASURED zero. */}
      <PanelHeading title="Channel activity" />
      <ThreadActivityStrip
        bins={activityBins}
        loading={activityLoading}
        metricLabel="Messages"
      />

      {/* 🔒 THE CATEGORY FACE (Samuel, 2026-09-15, superseding the collapsed
          disclosure that shipped hours earlier): a peer of "Channel info" and
          "Channel activity", list open, no badge, BELOW the strip — facts → what
          has been happening → what is addressed to YOU → people.
          ⚠ `inset="flush"` (Samuel, 2026-09-17): a top-level category, not a
          disclosure's contents, so the rows hang on the tab's own column edge. */}
      {mentionsLayout === "category" && (
        <>
          <PanelHeading title="Mentions" />
          <MentionsList
            mentions={bundle.mentions}
            truncated={bundle.truncated}
            loading={bundle.loading}
            channelName={channelName}
            index={bundle.index}
            onOpenMention={bundle.onOpen}
            onMarkAllRead={bundle.onMarkAllRead}
            inset="flush"
          />
        </>
      )}

      {/* ⚠ Two INERT `IconButton`s stood here and are deleted (R-46,
          2026-09-17) — mock markup with no `onClick`, i.e. dead controls (§5).
          🔒 "Add member" came back as a REAL control the same day (F-721): the
          page-action pill over `invite-dialog.tsx`, gated as the server gates
          the write. "Filter members" did not — the roster is bounded and short. */}
      <PanelHeading
        title="Members"
        trailing={
          <>
            <span className="text-caption text-text-muted">{members.length}</span>
            {membersAction}
          </>
        }
      />
      {/* 🔒 `index.currentUserId` IS THE VIEWER — the id this surface already
          holds, never a second resolution (2026-09-08; `view-model.ts ›
          isPresentForViewer`). F-723 is what happens without it: the override
          that reports the operator present while THIS desktop renderer is
          running cannot fire, and they read as offline in their own channel. */}
      <div data-testid="channel-members">
        <MemberRoster
          members={members}
          emptyLine={rosterEmptyLine}
          viewerUserId={index.currentUserId}
        />
      </div>

      {/* WHAT THE HOST ADDS, under the list it changes (Samuel, 2026-08-25). */}
      {extras?.belowRoster}
    </div>
  );
}

"use client";

/**
 * **THE CHANNEL RECORD'S INFO TAB — THE ONE BODY, ON EVERY HOST.** Channel
 * metadata, the mentions inbox, the activity strip and the roster.
 *
 * 🔒 **THERE WAS A SECOND ONE UNTIL WAVE 1A (2026-09-17), AND DELETING IT IS
 * WHAT THIS FILE IS FOR.** `apps/desktop-ui/src/pages/home/person-info-tab.tsx`
 * was 402 lines composing the same ladder out of the same leaves through the
 * body-REPLACING `infoTab` slot, and the two docblocks each asserted the panes
 * "are MEANT TO MATCH" — which is a sentence a codebase writes when it knows the
 * two are going to stop matching. They had already stopped four times: the
 * mentions section (2026-09-15), the header write (2026-09-17), the activity
 * strip, and the viewer id that made the operator read as OFFLINE in their own
 * channel (**F-723**). A host may now only ADD
 * (`channel-surface-contract.ts › ChannelInfoExtras`).
 *
 * ⚠ **TWO RULED FACES, ONE BRANCH — NOT A FORK.**
 * `ChannelSurfaceCapabilities.mentionsLayout` picks between the workspace's
 * collapsed disclosure inside the card and /home's open top-level category below
 * the activity strip (Samuel, 2026-09-15). Both draw `mentions-list.tsx`, from
 * one bundle the surface minted. The capability's own docblock carries the ruling
 * and why the POSITION travels with the face.
 *
 * WIRED: channel info (creator / created) off the channel row, the CURATED rows
 * off `channels.info_card` (R-19, 2026-09-17), MEMBERS off the surface's
 * `use-channel-members` read (presence is the server's verdict —
 * `view-model.ts › isPresentForViewer`, 2026-09-08), the MENTIONS inbox off
 * `use-channel-mentions` (Phase 6), and the activity strip since 2026-09-05
 * (F-316). ⚠ **IT READS NOTHING ITSELF** — every one of those is
 * `channel-surface-data.ts`, mounted once by the HOST (INVARIANTS §7).
 *
 * ⚠ NOTHING ON THIS TAB IS HARDCODED (2026-09-17). "Linked threads" was the last
 * fixture-fed section; R-45 deleted it.
 */

import { MetaRowDivider, PanelHeading } from "./bits";
import { InfoTabCard } from "./info-tab-card";
import type { ChannelHeaderEdit } from "./info-inline-edit";
import type { ChannelInfoCardEdit } from "./info-card-rows";
import { MemberRoster } from "./member-roster";
import { ThreadActivityStrip, type ActivityBin } from "./thread-activity";
import { MentionsDisclosure, type MentionsBundle } from "./mentions-disclosure";
import { MentionsList } from "./mentions-list";
import type { AuthorIndex } from "./view-model";
import type { ChannelInfoExtras } from "./channel-surface-contract";
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
  mentionsLayout?: "disclosure" | "category";
  index: AuthorIndex;
  onOpenMention: (mention: ChannelMention) => void;
  onMarkAllMentionsRead: () => void;
  /**
   * CLICK-TO-EDIT NAME + DESCRIPTION (Samuel, 2026-09-16). ABSENT is the
   * display face and the default, so a host that has not wired the write —
   * every test harness, and any surface without a refetch gate — renders
   * exactly what this tab rendered before. The host resolves both halves of
   * "may this line open" (`surface-info-panel.tsx`).
   */
  headerEdit?: ChannelHeaderEdit;
  /**
   * 🔒 **THE CURATED `channels.info_card` ROWS' WRITE (Samuel's ruling R-19,
   * 2026-09-17).** The column is on `channels` — every channel can carry curated
   * rows — and until this ruling exactly ONE surface rendered them, so a workspace
   * channel could hold rows no workspace surface showed. A stored row nothing
   * displays is a data trap.
   *
   * ⚠ **ABSENT MEANS THE ROWS ARE NOT DRAWN AT ALL, NOT DRAWN INERT.** Every row
   * carries a hover × and its value is the edit target (`info-card-rows.tsx ›
   * InfoCardCustomRow`), so a body whose host has not wired the write would ship
   * two dead controls per row — the thing INVARIANTS §5 forbids, and worse here
   * than showing nothing, because a × that does not remove reads as data loss.
   * The one product host (`surface-info-panel.tsx`) always passes it; what does
   * not is a test harness with no card to draw.
   */
  infoCardEdit?: ChannelInfoCardEdit;
  /**
   * 🔒 **"No members in this channel." — TRUE ON A WORKSPACE CHANNEL, NEVER ON A
   * CONTAINER THE VIEWER IS INSIDE.** Default on, like every other default here.
   *
   * ⚠ **IT IS DERIVED, NOT A NEW FLAG** (`surface-info-panel.tsx`:
   * `capabilities?.memberManagement !== false`). The hosts that pass
   * `memberManagement: false` — /home and the guest lane — are exactly the hosts
   * whose roster ALWAYS holds the reader, because the only door in is a link the
   * reader claimed (§4A: every workspace-level add answers
   * `LINK_CONTAINER_CLOSED`). There the sentence could only ever appear for one
   * frame during the roster read, stating something false. A public workspace
   * channel, by contrast, really can be read by nobody's member.
   */
  rosterEmptyLine?: boolean;
  /** WHAT THE HOST ADDS — named regions, never a body
   *  (`channel-surface-contract.ts › ChannelInfoExtras`). */
  extras?: ChannelInfoExtras;
}) {
  // ⚠ ONE BUNDLE, BOTH FACES. `index` is the SURFACE's — the mentions list and
  // the roster resolve authors and the viewer from one index, never two.
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
      {/* ⚠ "Channel info", NOT "Main info" (Samuel, 2026-09-05): the old title
          said where the block sat rather than what it was about.
          ⚠ NO NAME HEADING ABOVE THE CARD (Samuel, 2026-09-05, live review of the
          /home pane). The channel's name is a FIELD of the card — the first row
          under this heading, the subject before its facts — not a title floating
          over it. */}
      <PanelHeading title="Channel info" />
      <div className="px-2">
        <InfoTabCard
          channel={channel}
          channelName={channelName}
          members={members}
          headerEdit={headerEdit}
          infoCardEdit={infoCardEdit}
        />
        {/* THE COLLAPSED FACE — a row INSIDE the card, with the unread badge.
            `mentions-disclosure.tsx` owns the label, the badge and the open
            state. */}
        {mentionsLayout === "disclosure" && (
          <>
            <MetaRowDivider />
            <MentionsDisclosure channelName={channelName} bundle={bundle} />
          </>
        )}
        {/* ⚠ **THE THREADS-COUNT ROW STOOD HERE AND IS DELETED (Samuel's ruling
            R-22, 2026-09-17).** It printed the length of the same bounded list the
            Threads TAB already badges (`info-panel-tabs.ts › tabCount`), one row
            below the tab row carrying it — two statements of one number, and the
            badge is the one attached to the thing it counts. The row was also the
            duplicate rather than the gap: /home's Info tab never had it. */}
      </div>

      {/* ⚠ **"LINKED THREADS" STOOD HERE AND IS DELETED (Samuel's ruling R-45,
          2026-09-17).** Two hardcoded rows with no `onClick` and no relation
          behind them, marked hardcoded at this site since 2026-08-18. A thread
          belongs to one channel and links to nothing, so there was never a read
          to wire — and a dead control on the surface that is meant to be the
          reference is the thing INVARIANTS §5 forbids. `HARDCODED_LINKED_THREADS`
          went with it. ⚠ Reviving the IDEA means a schema answer first. */}

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
          MEASURED zero.
          ⚠ **ONE READ FOR THE WHOLE SURFACE SINCE WAVE 1A** — /home mounted a
          second `useOverviewSeries` on this identical key, in a wrapper that
          existed only to make it. */}
      <ThreadActivityStrip
        bins={activityBins}
        loading={activityLoading}
        metricLabel="Messages"
      />

      {/* 🔒 **THE CATEGORY FACE (Samuel, 2026-09-15, live review, superseding the
          collapsed disclosure that shipped hours earlier): a PEER of "Channel
          info" and "Channel activity", with its own heading, no dropdown, and the
          list rendered OPEN.** ⚠ **AND IT SITS BELOW THE STRIP**, which is the
          same ruling: facts → what has been happening → what is addressed to YOU
          → people. ⚠ **NO UNREAD BADGE, AND NOTHING IS LOST**: the count existed
          to describe a list you could not see; open, every unread row carries its
          own dot and tint. ⚠ **`inset="flush"`** (Samuel, 2026-09-17: *"each
          individual mention is starting further right … it should start at the
          same place"*) — this is a top-level category, not a disclosure's
          contents, so the rows hang on the tab's own column edge. */}
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

      {/* ⚠ **TWO INERT `IconButton`s — "Add member" and "Filter members" — STOOD IN
          THIS HEADING AND ARE DELETED (Samuel's ruling R-46, 2026-09-17).** Neither
          carried an `onClick`: they were markup from the design mock that the port
          transcribed, and Samuel deliberately did NOT copy them to /home on
          2026-08-25 — *"a port is not a transcription."* A control that does
          nothing is a dead control (INVARIANTS §5), and this heading now reads the
          way /home's already did: the count, and nothing else.
          ⚠ **F-721 — "Add member" → the invite dialog is a FOLLOW-UP, not a
          regression.** R-46's option (b) was to wire it to the dialog the Settings
          tab already opens (`invite-dialog.tsx › InviteDialog`, mounted by
          `channel-manage.tsx`) and delete only the filter; Samuel took (a) with
          (b) as a later ticket. The act is not lost meanwhile — **Add members** is
          on the Settings tab, capability-gated (`settings-tab.tsx`,
          `memberManagement`). */}
      <PanelHeading
        title="Members"
        trailing={
          <span className="text-caption text-text-muted">{members.length}</span>
        }
      />
      {/* ⚠ THE ROSTER IS `member-roster.tsx` SINCE 2026-08-25 — it was
          module-private here, which is how the account surface came to have a
          roster of its own.
          🔒 ⚠ `index.currentUserId` IS THE VIEWER, the id this surface already
          holds — no second resolution (2026-09-08; `view-model.ts ›
          isPresentForViewer`). **F-723 is what happens when a host draws this
          roster without it**: the override that reports the operator present
          whenever THIS desktop app is rendering cannot fire, and they read as
          offline in their own channel. */}
      <div data-testid="channel-members">
        <MemberRoster
          members={members}
          emptyLine={rosterEmptyLine}
          viewerUserId={index.currentUserId}
        />
      </div>

      {/* WHAT THE HOST ADDS, UNDER THE LIST IT CHANGES (Samuel, 2026-08-25) —
          /home's Add person / Link out pair, and nothing on any other host. */}
      {extras?.belowRoster}
    </div>
  );
}

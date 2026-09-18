"use client";

/**
 * Channels — the right panel's INFO tab: channel metadata, the Mentions
 * disclosure, the activity heatmap and the roster.
 *
 * ⚠ THE MENTIONS ROW IS SHARED WITH /home's OWN INFO TAB since 2026-09-15
 * (`mentions-disclosure.tsx`), which also carries the "Tags" -> "Mentions"
 * rename. The two panes are separate compositions of one ladder and are MEANT
 * TO MATCH — this file's Description row says the same thing.
 *
 * WIRED: channel info (creator / created) off the channel row, the CURATED
 * rows off `channels.info_card` (R-19, 2026-09-17), MEMBERS off `use-channel-members` (presence is the
 * server's verdict — `view-model.ts › isPresentForViewer`, 2026-09-08), the MENTIONS
 * inbox off `use-channel-mentions` (Phase 6), and the activity strip since
 * 2026-09-05 (F-316).
 *
 * ⚠ NOTHING ON THIS TAB IS HARDCODED ANY MORE (2026-09-17). "Linked threads" was
 * the last fixture-fed section; R-45 deleted it.
 */

import {
  AlignLeft,
  Calendar,
  Type,
  UserRound,
} from "lucide-react";
import { Avatar } from "@/shared/ui/avatar";
import { formatDate } from "@/shared/lib/format-time";
import { MetaRow, MetaRowDivider, PanelHeading } from "./bits";
import { InlineEditText, type ChannelHeaderEdit } from "./info-inline-edit";
import {
  InfoCardCustomRow,
  type ChannelInfoCardEdit,
} from "./info-card-rows";
import {
  EMPTY_INFO_CARD,
  removeInfoCardRow,
  upsertInfoCardRow,
} from "../info-card";
import { MemberRoster } from "./member-roster";
import { ThreadActivityStrip, type ActivityBin } from "./thread-activity";
import { MentionsDisclosure } from "./mentions-disclosure";
import { memberPerson, type AuthorIndex } from "./view-model";
import { CREATED_ROW_LABEL, memberLabel } from "../lib/channel-display";
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
  index,
  onOpenMention,
  onMarkAllMentionsRead,
  headerEdit,
  infoCardEdit,
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
}) {
  // ⚠ THE TAGS ROW MOVED TO `mentions-disclosure.tsx` (2026-09-15) — its open
  // state, its unread arithmetic and its markup went with it, because a SECOND
  // Info tab (the home space's) now renders the same row and two spellings of
  // one control drift on the first change. Nothing about it changed here.
  const creator = members.find((m) => m.userId === channel.createdBy) ?? null;
  /**
   * 🔒 **ONLY A STORED NAME OPENS** (Samuel, 2026-09-16). A 1:1 is TITLED after
   * the other member — `channel-display.ts › channelDisplayName` answers the
   * peer's name and `channel.name` is not what anybody reads — so a field bound
   * to the stored column on a DM would let somebody type over a value no surface
   * shows, and a field bound to the DERIVED one would write the peer's name into
   * the room. Neither is an edit, so the DM keeps the display face on BOTH rows.
   * ⚠ IT IS `channel.isDirect` AND NOT `channelName !== channel.name`: those two
   * strings are equal whenever a DM's peer cannot be resolved, which is exactly
   * the moment the row must not become editable.
   */
  const headerEditable = headerEdit?.canEdit === true && !channel.isDirect;
  // ⚠ §8 STALE-CACHE, SPELLED INLINE AT THE READ and never behind an accessor:
  // the channel list is IndexedDB-persisted with a 24h `gcTime`, so the first
  // paint after an upgrade serves rows minted before this column existed and the
  // key is simply ABSENT. `EMPTY_INFO_CARD` is the frozen shared default
  // (`info-card.ts`), which is also what `{}` parses to server-side.
  const card = channel.infoCard ?? EMPTY_INFO_CARD;

  return (
    <div className="min-h-0 flex-1 overflow-y-auto pb-6">
      {/* ⚠ "Channel info", NOT "Main info" (Samuel, 2026-09-05): the old title
          said where the block sat rather than what it was about. */}
      <PanelHeading title="Channel info" />
      <div className="px-2">
        {/* ⚠ FIRST, ABOVE CREATOR — the subject before its facts. ⚠ THE READ FACE
            IS `channelName`, THE DERIVED ONE, never `channel.name`: a 1:1 is
            titled after the other member (`peerNamedHeader` decides it, upstream),
            so the stored column would name a DM after nobody. **The EDITOR binds
            to `channel.name`**, which is the only writable half — and it opens on
            a stored-name channel only, see `headerEditable` above.
            ⚠ AT EVERY WIDTH (Samuel, 2026-09-05, second ruling): the header above
            the CHAT is fine and the name is ALSO a field of this card, always. The
            duplicate he reported was a title inside the /home pane
            (`apps/desktop-ui › person-info-tab.tsx`).
            ⚠ NO `Hash` GLYPH IN FRONT OF THE NAME (Samuel, 2026-09-16) — the same
            ruling that took it off the pane header. `Type` is the row's icon now. */}
        <MetaRow icon={Type} label="Name">
          <InlineEditText
            label="Channel name"
            // ⚠ THE TWO FACES READ FROM DIFFERENT COLUMNS ON PURPOSE — see above.
            value={headerEditable ? channel.name : channelName}
            editable={headerEditable}
            busy={headerEdit?.busy === true}
            // `schema.ts › ChannelNameSchema` — `safeLabel("Channel name", 120)`.
            maxLength={120}
            onCommit={(next) => {
              // ⚠ AN EMPTY NAME IS A CANCEL, NOT AN EMPTY ROOM. The server
              // refuses it (`safeLabel` has a min), and a channel with no name
              // cannot be found again in anybody's sidebar.
              if (next !== "") headerEdit?.onSaveName(next);
            }}
          />
        </MetaRow>
        <MetaRowDivider />
        {/* ⚠ **"DESCRIPTION" IS THE PRODUCT'S WORD FOR `channels.topic` (ruling,
            Samuel, 2026-09-15)** — no new column.
            ⚠ **SUPERSEDED, NOT DELETED (Samuel, 2026-09-16).** This said *"DISPLAY
            ONLY: editing a channel's header is channel management's (`PATCH
            /api/channels/{id}`)"*. The ROUTE half is still true and is the one this
            row writes through — there is no new endpoint — but the row is no longer
            display only: **name and description are click-to-edit here**, for a
            member who may manage the channel, on a channel whose name is stored.
            The management surface is unchanged and adds no editor of its own.
            "None", no explainer sentence (minimal-copy ruling) — and it is the
            CLICK TARGET, so an empty description opens on the empty string rather
            than on the word. ⚠ THE SAME ROW IS ON /home's own card —
            `apps/desktop-ui › person-info-tab.tsx`, two compositions of one ladder,
            and a ruling on it lands on both. */}
        <MetaRow icon={AlignLeft} label="Description">
          <InlineEditText
            label="Channel description"
            value={channel.topic}
            editable={headerEditable}
            busy={headerEdit?.busy === true}
            // `schema.ts › ChannelTopicSchema` — `safeOptionalLabel(…, 2000)`.
            // ⚠ EMPTY IS LEGAL HERE and clears the description, which is why this
            // one has no non-empty guard: the column is NOT NULL default ''.
            maxLength={2000}
            placeholder="None"
            emptyClassName="text-text-muted"
            onCommit={(next) => headerEdit?.onSaveTopic(next)}
          />
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
        {/* ⚠ **"Created" + `formatDate`, NOT "Date of creation" + `formatShortDate`
            (Samuel's ruling R-20, 2026-09-17).** The label is a CONSTANT shared with
            /home's own card, and the formatter keeps the YEAR — which on a creation
            date is the component that matters. See `channel-display.ts ›
            CREATED_ROW_LABEL` for why the string is not written here. */}
        <MetaRow icon={Calendar} label={CREATED_ROW_LABEL}>
          <span className="text-body text-text-primary">
            {formatDate(channel.createdAt)}
          </span>
        </MetaRow>
        {/* ⚠ **THE STATUS ROW (Active / Archived) STOOD HERE AND IS DELETED
            (Samuel's ruling R-21, 2026-09-17): *"a user can delete a channel; no
            point in archives."* It was the only reader of `channel.archivedAt` on
            either info body. ⚠ **R-21 WAS ASKED AS "should /home get this row too"
            and answered in the other direction** — there is no Status row to add
            because there is no archived state to show. A channel exists or it is
            deleted. */}
        {/* 🔒 **THE CURATED ROWS (Samuel's ruling R-19, 2026-09-17) — the same
            `info-card-rows.tsx › InfoCardCustomRow` /home has rendered since
            2026-08-25, not a second renderer.** `channels.info_card` is a column on
            `channels`, validated and PATCH-writable on every channel, and until
            this ruling only /home's card drew it: a workspace channel could carry
            curated rows that no workspace surface showed.
            ⚠ **BELOW THE BUILT-INS AND ABOVE MENTIONS**, which is /home's order —
            these are card FACTS, and the inbox below them is not.
            ⚠ **NO ADD AFFORDANCE HERE.** `InfoCardAddRow` is commented out on
            /home at Samuel's explicit instruction (2026-09-15) and this body does
            not revive it; R-19 is about DISPLAYING what is stored. Reading, editing
            in place and removing are what the column already supported. */}
        {infoCardEdit !== undefined &&
          card.rows.map((row) => (
            <div key={row.id}>
              <MetaRowDivider />
              <InfoCardCustomRow
                row={row}
                onChange={(next) => infoCardEdit.onSave(upsertInfoCardRow(card, next))}
                onRemove={() => infoCardEdit.onSave(removeInfoCardRow(card, row.id))}
              />
            </div>
          ))}
        <MetaRowDivider />
        {/* The mentions inbox — ONE component, shared with the home space's Info
            tab (`mentions-disclosure.tsx`), which owns the label and the badge. */}
        <MentionsDisclosure
          channelName={channelName}
          bundle={{
            mentions,
            truncated: mentionsTruncated,
            loading: mentionsLoading,
            index,
            onOpen: onOpenMention,
            onMarkAllRead: onMarkAllMentionsRead,
          }}
        />
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
          MEASURED zero. */}
      <ThreadActivityStrip
        bins={activityBins}
        loading={activityLoading}
        metricLabel="Messages"
      />

      {/* ⚠ **TWO INERT `IconButton`s — "Add member" and "Filter members" — STOOD IN
          THIS HEADING AND ARE DELETED (Samuel's ruling R-46, 2026-09-17).** Neither
          carried an `onClick`: they were markup from the design mock that the port
          transcribed, and Samuel deliberately did NOT copy them to /home on
          2026-08-25 — *"a port is not a transcription."* A control that does
          nothing is a dead control (INVARIANTS §5), and this heading now reads the
          way /home's already did: the count, and nothing else
          (`pages/home/person-members.tsx`).
          ⚠ **F-720 — "Add member" → the invite dialog is a FOLLOW-UP, not a
          regression.** R-46's option (b) was to wire it to the dialog the Settings
          tab already opens (`invite-dialog.tsx › InviteDialog`, mounted by
          `channel-manage.tsx`) and delete
          only the filter; Samuel took (a) with (b) as a later ticket. The act is
          not lost meanwhile — **Add members** is on the Settings tab, capability-
          gated (`settings-tab.tsx`, `memberManagement`). Re-adding it here is a
          wiring job with a home already built, which is exactly why it did not need
          to stay as a stub. */}
      <PanelHeading
        title="Members"
        trailing={
          <span className="text-caption text-text-muted">{members.length}</span>
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

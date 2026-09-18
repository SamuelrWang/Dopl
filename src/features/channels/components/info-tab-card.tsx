"use client";

/**
 * **THE "Channel info" CARD** — the fixed ladder (Name · Description · Creator ·
 * Created) plus whatever curated rows `channels.info_card` carries.
 *
 * ⚠ **ITS OWN FILE ON §1's CAP (wave 1A, 2026-09-17), AND NOTHING IN IT CHANGED
 * IN THE MOVE.** `info-tab.tsx` absorbed /home's fork and crossed 500 lines; the
 * card is the half of that body that is a FACT LIST with a write behind it, where
 * the rest is sections (activity, mentions, roster) the tab arranges. A "tidy"
 * while moving is how a move becomes a redesign nobody reviewed — every ⚠ below
 * is `info-tab.tsx`'s.
 *
 * ⚠ **IT IS A FRAGMENT, AND IT ENDS AFTER THE LAST CURATED ROW WITH NO TRAILING
 * DIVIDER.** The `px-2` box is `info-tab.tsx`'s, because what sits in it after
 * these rows is the caller's choice — the Mentions disclosure on the workspace
 * face, nothing at all on the home face
 * (`ChannelSurfaceCapabilities.mentionsLayout`) — and a divider that belongs to
 * whatever follows has to be drawn by whatever follows. Returning a fragment is
 * what kept the emitted DOM byte-identical through the split.
 */

import { AlignLeft, Calendar, Type, UserRound } from "lucide-react";
import { Avatar } from "@/shared/ui/avatar";
import { formatDate } from "@/shared/lib/format-time";
import { MetaRow, MetaRowDivider } from "./bits";
import { InlineEditText, type ChannelHeaderEdit } from "./info-inline-edit";
import { InfoCardCustomRow, type ChannelInfoCardEdit } from "./info-card-rows";
import {
  EMPTY_INFO_CARD,
  removeInfoCardRow,
  upsertInfoCardRow,
} from "../info-card";
import { memberPerson } from "./view-model";
import { CREATED_ROW_LABEL, memberLabel } from "../lib/channel-display";
import type { Channel, ChannelMember } from "../types";

export function InfoTabCard({
  channel,
  channelName,
  members,
  headerEdit,
  infoCardEdit,
}: {
  channel: Channel;
  /** The DERIVED display name — `peerNamedHeader` settled it, upstream. */
  channelName: string;
  /** THE SURFACE'S ROSTER — the Creator row's only source. */
  members: ChannelMember[];
  headerEdit?: ChannelHeaderEdit;
  infoCardEdit?: ChannelInfoCardEdit;
}) {
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
   * ⚠ **ONE DECLARATION SINCE WAVE 1A.** /home's fork spelled this same
   * expression a second time, verbatim, with a docblock explaining that it was
   * kept verbatim. That is the shape of a rule about to drift.
   * ⚠ **THE CONSEQUENCE IS WORTH KNOWING ON /home:** a home container minted
   * before the 2026-08-24 channel-first inversion still carries `is_direct = true`,
   * so its card stays display-only. Lifting that is a one-word ruling, not a code
   * question.
   */
  const headerEditable = headerEdit?.canEdit === true && !channel.isDirect;
  // ⚠ §8 STALE-CACHE, SPELLED INLINE AT THE READ and never behind an accessor:
  // the channel list is IndexedDB-persisted with a 24h `gcTime`, so the first
  // paint after an upgrade serves rows minted before this column existed and the
  // key is simply ABSENT. `EMPTY_INFO_CARD` is the frozen shared default
  // (`info-card.ts`), which is also what `{}` parses to server-side.
  const card = channel.infoCard ?? EMPTY_INFO_CARD;

  return (
    <>
      {/* ⚠ FIRST, ABOVE CREATOR — the subject before its facts. ⚠ THE READ FACE
          IS `channelName`, THE DERIVED ONE, never `channel.name`: a 1:1 is
          titled after the other member (`peerNamedHeader` decides it, upstream),
          so the stored column would name a DM after nobody. **The EDITOR binds
          to `channel.name`**, which is the only writable half — and it opens on
          a stored-name channel only, see `headerEditable` above.
          ⚠ AT EVERY WIDTH (Samuel, 2026-09-05, second ruling): the header above
          the CHAT is fine and the name is ALSO a field of this card, always. The
          duplicate he reported was a title inside the /home pane, which that
          pane stopped drawing the same day and no longer exists to draw.
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
          than on the word. */}
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
          (Samuel's ruling R-20, 2026-09-17).** The label is a CONSTANT, and it was
          a constant because two bodies had to agree; there is one body now and the
          constant stays, because `thread-info-tab.tsx` still spells the other one
          (F-722). The formatter keeps the YEAR — which on a creation date is the
          component that matters. ⚠ **THE GLYPH IS `Calendar`**: /home's fork drew
          `CalendarDays`, which is the one pixel-level difference the collapse
          settles rather than preserves. */}
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
          ⚠ **BELOW THE BUILT-INS**, which is /home's order — these are card
          FACTS, and what follows them is not.
          ⚠ **NO ADD AFFORDANCE.** `InfoCardAddRow` was commented out on /home at
          Samuel's explicit instruction (2026-09-15) and this body does not revive
          it; R-19 is about DISPLAYING what is stored. Reading, editing in place
          and removing are what the column already supported. ⚠ The parked sketch
          went with /home's fork in wave 1A — `info-card-rows.tsx › InfoCardAddRow`
          is still exported and is where the UI he wanted kept actually lives. */}
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
    </>
  );
}

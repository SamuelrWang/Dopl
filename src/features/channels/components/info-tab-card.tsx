"use client";

/**
 * **THE "Channel info" CARD** — the fixed ladder (Name · Description · Creator ·
 * Created) plus whatever curated rows `channels.info_card` carries. Split out
 * of `info-tab.tsx` at §1's cap when that file absorbed /home's fork (wave 1A,
 * 2026-09-17).
 *
 * ⚠ A FRAGMENT, ending after the last curated row with NO trailing divider: the
 * `px-2` box is the tab's, what follows these rows is the caller's choice
 * (`mentionsLayout`), and a divider that belongs to whatever follows has to be
 * drawn by it.
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
   * 🔒 ONLY A STORED NAME OPENS (Samuel, 2026-09-16). A 1:1 is titled after the
   * other member, so a field bound to the stored column would let somebody type
   * over a value no surface shows, and one bound to the DERIVED name would write
   * the peer's name into the room. Neither is an edit.
   * ⚠ `channel.isDirect`, NOT `channelName !== channel.name`: those two strings
   * are equal whenever a DM's peer cannot be resolved, which is exactly the
   * moment the row must not become editable.
   * ⚠ On /home this means a container minted before the 2026-08-24 channel-first
   * inversion still carries `is_direct` and stays display-only. Lifting that is a
   * ruling, not a code question.
   */
  const headerEditable = headerEdit?.canEdit === true && !channel.isDirect;
  // ⚠ §8 STALE-CACHE, spelled inline at the read: the channel list is
  // IndexedDB-persisted with a 24h `gcTime`, so the first paint after an upgrade
  // serves rows minted before this column existed and the key is simply ABSENT.
  const card = channel.infoCard ?? EMPTY_INFO_CARD;

  return (
    <>
      {/* ⚠ The READ face is `channelName`, the DERIVED one, because the stored
          column would name a DM after nobody; the EDITOR binds to `channel.name`,
          the only writable half (see `headerEditable`).
          ⚠ The name is a field of this card AT EVERY WIDTH (Samuel, 2026-09-05),
          and carries no `Hash` glyph (Samuel, 2026-09-16). */}
      <MetaRow icon={Type} label="Name">
        <InlineEditText
          label="Channel name"
          value={headerEditable ? channel.name : channelName}
          editable={headerEditable}
          busy={headerEdit?.busy === true}
          // `schema.ts › ChannelNameSchema` — `safeLabel("Channel name", 120)`.
          maxLength={120}
          onCommit={(next) => {
            // ⚠ An empty name is a CANCEL, not an empty room: the server refuses
            // it, and a channel with no name is unfindable in anybody's sidebar.
            if (next !== "") headerEdit?.onSaveName(next);
          }}
        />
      </MetaRow>
      <MetaRowDivider />
      {/* ⚠ "Description" is the product's word for `channels.topic` (Samuel,
          2026-09-15) — no new column, and the write is the same `PATCH
          /api/channels/{id}` channel management already uses (Samuel,
          2026-09-16). "None" is the placeholder and the CLICK TARGET, so an
          empty description opens on the empty string rather than on the word. */}
      <MetaRow icon={AlignLeft} label="Description">
        <InlineEditText
          label="Channel description"
          value={channel.topic}
          editable={headerEditable}
          busy={headerEdit?.busy === true}
          // `schema.ts › ChannelTopicSchema` — `safeOptionalLabel(…, 2000)`.
          // ⚠ Empty is LEGAL here and clears the description — the column is
          // NOT NULL default '' — which is why this one has no guard.
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
      {/* ⚠ "Created" + `formatDate`, not "Date of creation" + `formatShortDate`
          (Samuel's ruling R-20, 2026-09-17) — the formatter keeps the YEAR, which
          on a creation date is the component that matters. The label is a shared
          CONSTANT because `thread-info-tab.tsx` reads it too (F-722, ruled
          2026-09-17). ⚠ The glyph is `Calendar`; /home's fork drew `CalendarDays`. */}
      <MetaRow icon={Calendar} label={CREATED_ROW_LABEL}>
        <span className="text-body text-text-primary">
          {formatDate(channel.createdAt)}
        </span>
      </MetaRow>
      {/* ⚠ A Status row (Active / Archived) stood here and is deleted with the
          archive feature (Samuel's ruling R-21, 2026-09-17): a channel exists or
          it is deleted.
          🔒 THE CURATED ROWS (Samuel's ruling R-19, 2026-09-17), below the
          built-ins, through the same `InfoCardCustomRow` /home has rendered since
          2026-08-25. Until this ruling a workspace channel could carry curated
          rows no workspace surface showed.
          ⚠ NO ADD AFFORDANCE — commented out on /home at Samuel's instruction
          (2026-09-15), and R-19 is about DISPLAYING what is stored.
          `info-card-rows.tsx › InfoCardAddRow` is still exported. */}
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

import type { ReactNode } from "react";
import { CalendarDays, Clock3, Hash, type LucideIcon } from "lucide-react";
import { formatChannelTimestamp, formatDate } from "@/shared/lib/format-time";
import type { MutationGate } from "@/shared/hooks/use-api-mutation";
import {
  MetaRow,
  MetaRowDivider,
  PanelHeading,
} from "@/features/channels/components/channels-v2/bits";
import {
  InfoCardAddRow,
  InfoCardCustomRow,
  InfoCardSection,
} from "@/features/channels/components/channels-v2/info-card-rows";
import { useChannelInfoCardWrite } from "@/features/channels/hooks/use-channel-info-card-writes";
import {
  EMPTY_INFO_CARD,
  INFO_CARD_MAX_ROWS,
  hideBuiltInRow,
  newInfoCardRowId,
  removeInfoCardRow,
  upsertInfoCardRow,
  type ChannelInfoCardBuiltInKey,
} from "@/features/channels/info-card";
import type { Channel } from "@/features/channels/types";
import type { HomeChannel } from "@/features/home/types";
import { channelTitle } from "./home-rows";
import { PersonMembers } from "./person-members";
import { PersonThreadActivity } from "./person-thread-activity";

/**
 * The Info tab of a home channel's surface — THE CHANNEL, exactly as a
 * workspace channel's own Info tab is (`channel-surface.tsx › infoTab`).
 *
 * 🔒 **ONE CARD, AND IT IS THE CHANNEL'S (Samuel, 2026-09-01).** This file said
 * "TWO CARDS, ONE PANEL" and meant it: with a peer the tab was that PERSON —
 * their face, their name as the heading, their email as the subline and again as
 * a built-in row — and with nobody it was the channel. So **adding a member
 * turned the tab into that member's profile**, and the sections under it
 * (Channel info, Thread activity) read as facts about them. A channel's
 * identity is not its roster's identity, and it does not change when the roster
 * does.
 *
 * ⚠ **THE SAME CORRECTION LANDED ON THE LIST ROW IN THE SAME CHANGE** —
 * `home-rows.ts › channelTitle` returns `channel.name` and nothing else now, and
 * `relationship-list.tsx` dropped its avatars. Both surfaces were reading one
 * derivation; both had to stop.
 *
 * ⚠ **MEMBERS APPEAR IN EXACTLY ONE PLACE ON THIS TAB: `PersonMembers`, at its
 * foot** — every member, with their face, their name and their address, where
 * each fact can be attributed to the person it belongs to.
 *
 * ⚠ THE COMPONENT AND FILE ARE STILL NAMED `Person*`, like `relationship-list`
 * next door and for the same reason: a rename is churn in files a later wave
 * rewrites. What changed is what the tab READS.
 *
 * ⚠ THE MOCK'S POSTURE SELECT, NOTES FIELD AND POLICY ROW ARE DELETED, not
 * disabled: none of the three has a backend, and a control that cannot be
 * saved is worse than an absent one.
 *
 * ⚠ THE CARD IS CURATED AND THE CURATION PERSISTS (Samuel, 2026-08-25). Every
 * Channel-info row carries a hover-only ×, and a discreet ghost row at the end of
 * the list adds a custom `label: value` pair. Both edits are stored on
 * `channels.info_card` and written through the PATCH that already writes the
 * channel — see `features/channels/info-card.ts`.
 *   ⚠ REMOVING A ROW REMOVES IT FROM THE CARD, NOT FROM THE WORLD. What changed
 *   is what this card shows. Do not "finish the job" by nulling anything.
 *
 * ⚠ THE ORDER IS HEADER → CHANNEL INFO → THREAD ACTIVITY → MEMBERS (+ ADD PERSON)
 * (Samuel, 2026-08-25 — corrected the same day; the first pass put Members
 * second). Add person moved out of the tab's foot and under the roster it
 * changes, which is what keeps the tab's one ACTION at its end.
 */
export function PersonInfoTab({
  homeChannel,
  channel,
  gate,
}: {
  homeChannel: HomeChannel;
  /**
   * The RESOLVED channel row — the card lives on it (`Channel.infoCard`), and
   * `relationship-record.tsx` has already had to fetch it to mount the surface
   * at all. Asking for both this and `homeChannel` is how the two come to
   * disagree, so the split is deliberate and narrow: `homeChannel` is the
   * account-level projection (peer, link-out), `channel` is the workspace row.
   */
  channel: Channel;
  /** THE surface's refetch gate — see `channel-surface.tsx ›
   *  ChannelInfoTabContext`. Never a second one minted here. */
  gate: MutationGate;
}) {
  // 🔒 THE CHANNEL'S OWN NAME. `channelTitle` returns `channel.name` and nothing
  // else since 2026-09-01 — the roster-derived title is gone, and that function's
  // docblock carries the ruling and its history.
  const name = channelTitle(homeChannel);
  // ⚠ CACHE-SHAPE FALLBACK: the persisted query cache (IndexedDB) serves
  // channel rows minted before `infoCard` existed, so the field can be absent
  // on the first paint after an upgrade even though the API now always sends
  // it. Absent reads as the empty card, exactly as `{}` parses server-side.
  const card = channel.infoCard ?? EMPTY_INFO_CARD;
  const { save } = useChannelInfoCardWrite({
    channelId: channel.id,
    workspaceId: channel.workspaceId,
    gate,
  });

  // ⚠ BUILT AS DATA, THEN FILTERED — never `hidden.includes(...)` written three
  // times inline. One list means the divider arithmetic below cannot disagree
  // with what is on screen, and adding a built-in row is one entry plus one key
  // in `info-card.ts`.
  //
  // 🔒 ⚠ **THE EMAIL ROW IS DELETED (Samuel, 2026-09-01) — IT WAS THE LAST
  // MEMBER-DERIVED FACT ON THIS CARD.** It rendered only when the container held
  // EXACTLY ONE peer, which is what made it a morph: a channel's info card grew
  // a stranger's address the moment they claimed a link, and lost it again when
  // a second person joined. (It had already been dropped above one peer on
  // 2026-08-26, for the narrower reason that one address under a header naming
  // two other members reads as THEIRS — the same defect, caught one case
  // early.) **A card whose whole premise is curated facts about THIS CHANNEL
  // must not carry a fact about a person.**
  //
  // ⚠ **NOTHING IS LOST**: every member's address is one section down, beside
  // their face, in the roster (`PersonMembers` → `MemberRoster`, name over
  // EMAIL) — shown where it can be attributed, and the only place an added user
  // appears on this tab.
  //
  // ⚠ **`"email"` STAYS IN `info-card.ts › INFO_CARD_BUILT_IN_KEYS` AND MUST.**
  // Stored cards carry it in `hidden` for operators who removed the row while it
  // existed; that file already states the rule — a key hidden on a channel that
  // does not render the row is INERT rather than wrong. Dropping it from the
  // union would turn every one of those stored rows into a validation failure.
  const builtIns: BuiltInRow[] = [
    {
      key: "created" as const,
      icon: CalendarDays,
      label: "Created",
      value: (
        <span className="text-body text-text-primary">
          {formatDate(homeChannel.createdAt)}
        </span>
      ),
    },
    {
      key: "lastActivity" as const,
      icon: Clock3,
      label: "Last activity",
      value: (
        <span className="text-body text-text-primary">
          {homeChannel.lastMessageAt
            ? formatChannelTimestamp(homeChannel.lastMessageAt)
            : "No messages yet"}
        </span>
      ),
    },
  ].filter((row) => !card.hidden.includes(row.key));

  return (
    <div className="min-h-0 flex-1 overflow-y-auto pb-6">
      {/* 🔒 ⚠ **THE HEADER IS THE CHANNEL, AND ONLY THE CHANNEL (Samuel,
          2026-09-01).** It used to be a PERSON CARD chosen by roster size — an
          `AvatarStack`, a single `Avatar`, or a `Bot` glyph, over a title that
          was the peer's display name and a subline that was their email — so
          adding one member turned the whole Info tab into that member's
          profile, and the tab's remaining sections read as facts ABOUT THEM.
          **A channel's identity is not its roster's identity**, and the same
          correction landed on the list row in this change
          (`home-rows.ts › channelTitle`).
          ⚠ **NOTHING IS LOST AND NOTHING MOVED**: every member, with their face
          and their address, is in `PersonMembers` at the foot of this tab —
          which is where an added user is supposed to appear, and the only place
          they now do.
          ⚠ **NO GLYPH IN THE AVATAR'S PLACE EITHER.** A face here that varied
          with membership was the defect; a face that does not vary is a
          decoration this panel does not need, and initials minted from a
          channel name read as a person who does not exist. */}
      {/* ⚠ NO NAME HEADING ABOVE THE CARD (Samuel, 2026-09-05, live review of THIS pane).
          The channel's name is a FIELD of the card — the first row under "Channel info",
          the subject before its facts — not a title floating over it. This block used to
          print the name in title type here; the same ruling had already landed on the
          workspace channels page (`channels-v2/info-tab.tsx`) and not here, because the two
          panes are separate compositions of the same rows. ⚠ THEY ARE MEANT TO MATCH: a
          ruling on this card applies to both unless Samuel says which one it is for. */}
      {/* ⚠ "Channel info", NOT "Main info" (Samuel, live review 2026-08-28). The card is about
          THIS CHANNEL — its dates, its curated rows — and "Main" named a position on the tab
          rather than a subject. ⚠ THE STORED SHAPE IS UNTOUCHED: `info-card.ts › hidden` keys and
          the `channels.info_card` column still say what they said, so this is a label change and
          not a migration. */}
      <PanelHeading title="Channel info" />
      {/* ⚠ THE SECTION WRAPS THE ROWS AND NOT THE HEADING — the add affordance's
          hover is keyed to this element, and a wrapper that included the title
          would reveal the control from a hover that never entered the list. */}
      <InfoCardSection className="px-2">
        {/* ⚠ FIRST, ABOVE EVERY BUILT-IN — and FIXED: no × on this row, because a card
            with its subject removed is a card about nobody. It is `channelTitle`'s
            answer, the same derived name the rows list and the tabs use. */}
        <MetaRow icon={Hash} label="Name">
          <span className="truncate text-body text-text-primary">{name}</span>
        </MetaRow>
        {builtIns.map((row) => (
          <div key={row.key}>
            <MetaRowDivider />
            <MetaRow
              icon={row.icon}
              label={row.label}
              onRemove={() => save(hideBuiltInRow(card, row.key))}
            >
              {row.value}
            </MetaRow>
          </div>
        ))}
        {card.rows.map((row, i) => (
          <div key={row.id}>
            {(i > 0 || builtIns.length > 0) && <MetaRowDivider />}
            <InfoCardCustomRow
              row={row}
              onChange={(next) => save(upsertInfoCardRow(card, next))}
              onRemove={() => save(removeInfoCardRow(card, row.id))}
            />
          </div>
        ))}
        <InfoCardAddRow
          full={card.rows.length >= INFO_CARD_MAX_ROWS}
          onAdd={(label, value) =>
            save(
              upsertInfoCardRow(card, { id: newInfoCardRowId(), label, value })
            )
          }
        />
      </InfoCardSection>

      {/* ⚠ THREAD ACTIVITY SITS ABOVE MEMBERS (Samuel, 2026-08-25). The card
          reads facts → what has been happening → who is here and how to add
          somebody, so the one ACTION on the tab is the last thing on it. */}
      <PersonThreadActivity
        channelId={channel.id}
        workspaceSegment={homeChannel.workspaceSegment}
      />

      <PersonMembers homeChannel={homeChannel} />
    </div>
  );
}

/** One shipped Channel-info row, as data. `key` is what `info-card.ts › hidden`
 *  names — a row without one could not be removed. */
interface BuiltInRow {
  key: ChannelInfoCardBuiltInKey;
  icon: LucideIcon;
  label: string;
  value: ReactNode;
}

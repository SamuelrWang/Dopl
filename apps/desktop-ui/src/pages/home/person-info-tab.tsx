import type { ReactNode } from "react";
import {
  AlignLeft,
  CalendarDays,
  Hash,
  UserRound,
  type LucideIcon,
} from "lucide-react";
import { formatDate } from "@/shared/lib/format-time";
import type { MutationGate } from "@/shared/hooks/use-api-mutation";
import {
  MetaRow,
  MetaRowDivider,
  PanelHeading,
} from "@/features/channels/components/bits";
// ⚠ `InfoCardAddRow` LEFT THIS LIST 2026-09-15 with the add affordance (see the
// commented sketch below). The component still exists for the workspace card.
import {
  InfoCardCustomRow,
  InfoCardSection,
} from "@/features/channels/components/info-card-rows";
import { MentionsList } from "@/features/channels/components/mentions-list";
import type { MentionsBundle } from "@/features/channels/components/mentions-disclosure";
import { useChannelInfoCardWrite } from "@/features/channels/hooks/use-channel-info-card-writes";
import { useChannelMembers } from "@/features/channels/hooks/use-channel-members";
import { memberLabel } from "@/features/channels/lib/channel-display";
import { memberPerson } from "@/features/channels/components/view-model";
import { Avatar } from "@/shared/ui/avatar";
import {
  EMPTY_INFO_CARD,
  removeInfoCardRow,
  upsertInfoCardRow,
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
 * ⚠ THE ORDER IS HEADER → CHANNEL INFO → CHANNEL ACTIVITY → MENTIONS → MEMBERS
 * (+ ADD PERSON). The spine is Samuel's, 2026-08-25 — corrected the same day, the
 * first pass put Members second — and Add person moved out of the tab's foot and
 * under the roster it changes, which is what keeps the tab's one ACTION at its
 * end. ⚠ MENTIONS joined it 2026-09-15 as a TOP-LEVEL CATEGORY (his ruling,
 * superseding the collapsed row that shipped hours earlier), and moved BELOW the
 * activity strip the same hour on his live review.
 */
export function PersonInfoTab({
  homeChannel,
  channel,
  gate,
  mentions,
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
  /** THIS CHANNEL'S MENTIONS INBOX, already read by the surface and handed down with
   *  the gate — see `channel-surface.tsx › ChannelInfoTabContext.mentions` for
   *  why a tab may not fetch it or mint its handlers itself. */
  mentions: MentionsBundle;
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

  // 🔒 **THE SHIPPED ROWS ARE FIXED AND PERMANENT: Name, Description, Creator,
  // Created.** ⚠ "Last activity" WAS one of them and is DELETED (Samuel,
  // 2026-09-15, live review) — the strip one section down is what says when this
  // channel was last busy, and a timestamp above it was the same fact twice.** No × on any of them, and a stored
  // `hidden` key is INERT — the card renders every built-in regardless. `hidden`
  // stays in `info-card.ts` because stored cards carry it (and `"email"`, whose
  // row was deleted 2026-09-01); dropping the union would fail validation on
  // every one of those rows. Only CUSTOM rows are removable.
  //
  // ⚠ CREATOR reads the roster the surface already has (`useChannelMembers`, the
  // same read `PersonMembers` makes one section down — one cache entry, not a
  // second request). A creator who is no longer a member has no roster row and
  // an id is not a name, so the row says it does not know — the same answer the
  // workspace channels page gives (`channels/components/info-tab.tsx`).
  const { members } = useChannelMembers(
    homeChannel.channelId,
    homeChannel.workspaceId
  );
  const creator = members.find((m) => m.userId === channel.createdBy) ?? null;
  const builtIns: BuiltInRow[] = [
    // ⚠ **"DESCRIPTION" IS THE PRODUCT'S WORD FOR `channels.topic` (ruling,
    // Samuel, 2026-09-15)** — no new column. DISPLAY ONLY: editing a channel's
    // header is channel management's (`PATCH /api/channels/{id}`).
    // ⚠ THE SAME ROW IS ON THE WORKSPACE CHANNELS PAGE
    // (`channels/components/info-tab.tsx`) — two compositions of one ladder, and
    // a ruling on it lands on both.
    {
      key: "description",
      icon: AlignLeft,
      label: "Description",
      // ⚠ "None", one word, no explainer sentence (minimal-copy ruling).
      value: channel.topic ? (
        <span className="truncate text-body text-text-primary">
          {channel.topic}
        </span>
      ) : (
        <span className="text-body text-text-muted">None</span>
      ),
    },
    {
      key: "creator",
      icon: UserRound,
      label: "Creator",
      value: creator ? (
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
        <span className="text-body text-text-muted">Not in this channel</span>
      ),
    },
    {
      key: "created",
      icon: CalendarDays,
      label: "Created",
      value: (
        <span className="text-body text-text-primary">
          {formatDate(homeChannel.createdAt)}
        </span>
      ),
    },
  ];

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
          workspace channels page (`channels/components/info-tab.tsx`) and not here, because the two
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
            <MetaRow icon={row.icon} label={row.label}>
              {row.value}
            </MetaRow>
          </div>
        ))}
        {card.rows.map((row) => (
          <div key={row.id}>
            <MetaRowDivider />
            <InfoCardCustomRow
              row={row}
              onChange={(next) => save(upsertInfoCardRow(card, next))}
              onRemove={() => save(removeInfoCardRow(card, row.id))}
            />
          </div>
        ))}
        {/* ⚠ **THE ADD-A-ROW AFFORDANCE IS COMMENTED OUT, NOT DELETED, AT SAMUEL'S
            EXPLICIT INSTRUCTION (2026-09-15): *"comment out the UI of the add item
            button. Cuz I might reuse the UI down the line. But remove all other
            code."* So the MARKUP stays here as a parked sketch and every line that
            made it work is gone — `InfoCardAddRow`'s import, the `onAdd` handler and
            the `upsertInfoCardRow` call behind it.
            ⚠ **READING AND REMOVING ARE UNTOUCHED.** Custom rows already stored on
            `channels.info_card` still render and still carry their hover ×: the
            ability to CREATE one went, nothing that exists was hidden or nulled —
            the same rule this card's own docblock states about removal.
            ⚠ Reviving it means restoring the import and a write; the handler is not
            hiding anywhere.
        <InfoCardAddRow
          full={card.rows.length >= INFO_CARD_MAX_ROWS}
          onAdd={(label, value) =>
            save(upsertInfoCardRow(card, { id: newInfoCardRowId(), label, value }))
          }
        />
        */}
      </InfoCardSection>

      {/* ⚠ ACTIVITY SITS ABOVE MEMBERS (Samuel, 2026-08-25) — the card reads facts
          → what has been happening → who is here and how to add somebody, so the one
          ACTION on the tab is the last thing on it.
          ⚠ AND ABOVE MENTIONS (Samuel, 2026-09-15, live review): Mentions arrived
          between the card and this strip and he moved it below. The spine is
          unchanged in shape — facts, then activity, then what is addressed to YOU,
          then people. */}
      <PersonThreadActivity
        channelId={channel.id}
        workspaceSegment={homeChannel.workspaceSegment}
      />

      {/* ⚠ **A TOP-LEVEL CATEGORY, NOT A ROW INSIDE CHANNEL INFO** (Samuel,
          2026-09-15, superseding the collapsed disclosure that shipped hours
          earlier): it is a PEER of "Channel info" and "Channel activity", with
          its own heading and no dropdown, and the list renders OPEN.
          ⚠ **WHICH IS WHY /home DOES NOT USE `MentionsDisclosure`.** That
          component is the workspace panel's collapsed row and still is; a
          `defaultOpen` flag on it would have made one component mean two
          layouts, and the thing they genuinely share — the LIST — is shared
          directly. `mentions-disclosure.tsx` owns the collapsed row, this owns
          the category, and `MentionsList` is the one list under both.
          ⚠ **NO UNREAD BADGE HERE, AND NOTHING IS LOST**: the count existed to
          describe a list you could not see. Open, every unread row carries its
          own dot and tint (`mentions-list.tsx`), which is the same fact per row
          instead of summed into a number.
          ⚠ **THE DATA IS THE SURFACE'S** — same page, same server order, same
          50-row cap, same click (mark read, land the centre pane, nonced
          scroll), and the read is keyed on the surface's `workspaceId`, which
          for a home channel IS the home container id. */}
      <PanelHeading title="Mentions" />
      <MentionsList
        mentions={mentions.mentions}
        truncated={mentions.truncated}
        loading={mentions.loading}
        channelName={name}
        index={mentions.index}
        onOpenMention={mentions.onOpen}
        onMarkAllRead={mentions.onMarkAllRead}
      />

      <PersonMembers homeChannel={homeChannel} />
    </div>
  );
}

/** One shipped Channel-info row, as data. Fixed: `key` is a React key only. */
interface BuiltInRow {
  key: string;
  icon: LucideIcon;
  label: string;
  value: ReactNode;
}

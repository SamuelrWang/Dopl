import type { ReactNode } from "react";
import { Bot, CalendarDays, Clock3, Mail, type LucideIcon } from "lucide-react";
import { Avatar } from "@/shared/ui/avatar";
import { AvatarStack } from "@/shared/ui/avatar-stack";
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
import { channelPeople, channelSubline, channelTitle } from "./home-rows";
import { PersonMembers } from "./person-members";
import { PersonThreadActivity } from "./person-thread-activity";

/**
 * The Info tab of a home channel's surface — THE PERSON, where a workspace
 * channel shows its metadata and roster (`channel-surface.tsx › infoTab`).
 *
 * ⚠ TWO CARDS, ONE PANEL (2026-08-24). With a peer it is the PERSON: their
 * face, their email, the channel's dates. With none it is the CHANNEL: a glyph,
 * the channel's name, and only the facts that exist — an "Email —" row on a
 * solo channel answers a question nobody asked and implies a person who is not
 * there. The rows that survive both are the ones about the channel itself.
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
 *   ⚠ REMOVING A ROW REMOVES IT FROM THE CARD, NOT FROM THE WORLD. The peer's
 *   email is still on their profile, still on the roster, still in the header
 *   subline above; what changed is what this card shows. Do not "finish the
 *   job" by nulling anything.
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
  // ⚠ Everybody else in the container, oldest join first. The cache-shape rule
  // for `peers` lives in `channelPeople` and is enforced from `home-rows.test.ts`.
  const people = channelPeople(homeChannel);
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
  // with what is on screen, and adding a fourth built-in row is one entry plus
  // one key in `info-card.ts`.
  // 🔒 ⚠ THE EMAIL ROW IS A ONE-PERSON ROW AND IS DROPPED ABOVE ONE
  // (2026-08-26). It was already absent on a SOLO channel, for the reason at the
  // top of this file — a row answering a question nobody asked, implying a
  // person who is not there. **A container with three people asks the mirror
  // question and it has no honest answer**: one address under a header naming
  // two other members reads as THEIR address, and a card whose whole premise is
  // curated facts must not print a fact about the wrong person. Every member's
  // address is one section down, beside their face, in the roster
  // (`PersonMembers` → `MemberRoster`, name over EMAIL) — so nothing is lost,
  // it is shown where it can be attributed. ⚠ Do NOT "fix" this by stacking N
  // Email rows: the card is capped and curated, and the roster IS that list.
  const builtIns: BuiltInRow[] = [
    ...(people.length === 1
      ? [
          {
            key: "email" as const,
            icon: Mail,
            label: "Email",
            value: (
              <span className="truncate text-body text-text-primary">
                {people[0].email ?? "—"}
              </span>
            ),
          },
        ]
      : []),
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
      <div className="flex items-center gap-3 px-3.5 pt-4">
        {people.length > 1 ? (
          // ⚠ THE SAME STACK AS THE ROW, ONE STEP UP (2026-08-26). `md` is
          // `Avatar size="md"` to the pixel, so the header does not shift as a
          // channel grows; `max={4}` is the primitive's default and there is
          // room for it here where the 290px row only had room for three.
          <div className="shrink-0" aria-hidden>
            <AvatarStack
              size="md"
              users={people.map((p) => ({
                userId: p.userId,
                displayName: p.displayName || p.email || "Member",
                avatarUrl: p.avatarUrl,
              }))}
            />
          </div>
        ) : people.length === 1 ? (
          <Avatar person={people[0]} size="md" />
        ) : (
          // ⚠ `w-10 h-10` is `Avatar size="md"` — same reason the row's glyph
          // matches `sm`: the header must not shift with the peer's presence.
          <span
            aria-hidden
            className="btn-light flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-text-secondary"
          >
            <Bot size={18} />
          </span>
        )}
        <div className="min-w-0">
          <div className="truncate text-title font-semibold text-text-primary">
            {name}
          </div>
          {/* ⚠ ONE PEER KEEPS ITS ADDRESS; TWO OR MORE GET THE SIZE OF THE ROOM
              — `channelSubline`'s rule, shared with the list row so the two
              faces of one channel cannot say different things about it. The
              "No email on file" nuance is this header's alone: the row leaves
              that line blank rather than narrating an absence in a list. */}
          <div className="truncate text-caption text-text-muted">
            {people.length === 1
              ? (people[0].email ?? "No email on file")
              : channelSubline(homeChannel)}
          </div>
        </div>
      </div>

      {/* ⚠ "Channel info", NOT "Main info" (Samuel, live review 2026-08-28). The card is about
          THIS CHANNEL — its dates, its curated rows — and "Main" named a position on the tab
          rather than a subject. ⚠ THE STORED SHAPE IS UNTOUCHED: `info-card.ts › hidden` keys and
          the `channels.info_card` column still say what they said, so this is a label change and
          not a migration. The workspace channels page's own `channels-v2/info-tab.tsx` keeps its
          heading — a different tab, not renamed here. */}
      <PanelHeading title="Channel info" />
      {/* ⚠ THE SECTION WRAPS THE ROWS AND NOT THE HEADING — the add affordance's
          hover is keyed to this element, and a wrapper that included the title
          would reveal the control from a hover that never entered the list. */}
      <InfoCardSection className="px-2">
        {builtIns.map((row, i) => (
          <div key={row.key}>
            {i > 0 && <MetaRowDivider />}
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

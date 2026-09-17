"use client";

/**
 * THE /home RECORD PANE'S **Info** TAB, IN THE HERO SCENE — the same
 * composition `apps/desktop-ui/src/pages/home/person-info-tab.tsx` mounts,
 * over fixture data.
 *
 * 🔒 **SAMUEL, 2026-09-17, rejecting the scene this replaces:** *"a majority of
 * it is matching like the workspace pages. I want it to match the home space
 * pages."* The column was showing the THREAD face — "Thread info", "Parties",
 * a running-agents list — because the scene opened a thread. /home's channel
 * record shows **Channel info → Channel activity → Mentions → Members**, and
 * that spine is Samuel's (2026-08-25, re-ordered 2026-09-15).
 *
 * 🔑 **EVERY SECTION IS THE PRODUCT'S OWN COMPONENT, NOT A LOOK-ALIKE.**
 * `PanelHeading`, `MetaRow`, `MetaRowDivider`, `InfoCardSection`,
 * `InlineEditText`, `ThreadActivityStrip`, `MentionsList`, `MemberRoster` and
 * `Avatar` all live in the root tree and are imported here exactly as
 * `person-info-tab.tsx` imports them. **The order, the icons, the labels and
 * the headings are read off that file; do not re-word them here.**
 *
 * ⚠ **WHAT THE SCENE CANNOT MOUNT, AND WHY — TWO THINGS, BOTH READS.**
 *   - `PersonThreadActivity` wraps `ThreadActivityStrip` in a
 *     `useOverviewSeries` call. The strip itself is shared, so the scene renders
 *     the STRIP with scripted bins under the same `PanelHeading` that component
 *     uses ("Channel activity", Samuel 2026-09-05).
 *   - `PersonMembers` wraps `MemberRoster` in `useChannelMembers` and ends in
 *     `AddPersonDialog`, a write. The roster is shared and mounted; the dialog's
 *     TRIGGER is the page's black pill, which is `PAGE_ACTION_BTN` — the same
 *     constant, never a copied class list.
 *
 * ⚠ **THE INLINE EDITORS ARE MOUNTED `editable={false}`**, which is the real
 * component's non-manager face and renders plain text with no cursor change —
 * honest for a decorative pane where no write can land, and still the same
 * element the product draws.
 */

import { Type, AlignLeft, CalendarDays, UserRound } from "lucide-react";
import { formatDate } from "@/shared/lib/format-time";
import { Avatar } from "@/shared/ui/avatar";
import { PAGE_ACTION_BTN } from "@/shared/ui/page-action-button";
import {
  MetaRow,
  MetaRowDivider,
  PanelHeading,
} from "@/features/channels/components/bits";
import { InfoCardSection } from "@/features/channels/components/info-card-rows";
import { InlineEditText } from "@/features/channels/components/info-inline-edit";
import { MentionsList } from "@/features/channels/components/mentions-list";
import { MemberRoster } from "@/features/channels/components/member-roster";
import { ThreadActivityStrip } from "@/features/channels/components/thread-activity";
import { memberLabel } from "@/features/channels/lib/channel-display";
import { memberPerson } from "@/features/channels/components/view-model";
import type { AuthorIndex } from "@/features/channels/components/view-model";
import type { ChannelMember, ChannelMention } from "@/features/channels/types";

const NOOP = () => {};

export function DemoInfoTab({
  channelName,
  description,
  createdAt,
  creator,
  members,
  index,
  mentions,
  activityBins,
}: {
  channelName: string;
  description: string;
  /** ISO — `formatDate`, the row's own presenter. */
  createdAt: string;
  creator: ChannelMember;
  members: ChannelMember[];
  index: AuthorIndex;
  mentions: ChannelMention[];
  activityBins: readonly { date: string; count: number }[];
}) {
  return (
    // `person-info-tab.tsx`'s own scroller box, class for class.
    <div className="min-h-0 flex-1 overflow-y-auto pb-6">
      {/* ⚠ "Channel info", NOT "Main info" (Samuel, live review 2026-08-28) —
          the card is about THIS CHANNEL. ⚠ NO NAME HEADING ABOVE IT (Samuel,
          2026-09-05): the name is the card's FIRST ROW, not a title over it. */}
      <PanelHeading title="Channel info" />
      <InfoCardSection className="px-2">
        {/* 🔒 ⚠ **NO `Hash` GLYPH IN FRONT OF THE NAME** (Samuel, 2026-09-16,
            mirrored onto this card 2026-09-17) — `Type` is the row's icon. */}
        <MetaRow icon={Type} label="Name">
          <InlineEditText
            label="Channel name"
            value={channelName}
            editable={false}
            onCommit={NOOP}
          />
        </MetaRow>
        <MetaRowDivider />
        {/* ⚠ **"DESCRIPTION" IS THE PRODUCT'S WORD FOR `channels.topic`**
            (Samuel, 2026-09-15) — no new column, and no new label here. */}
        <MetaRow icon={AlignLeft} label="Description">
          <InlineEditText
            label="Channel description"
            value={description}
            editable={false}
            placeholder="None"
            emptyClassName="text-text-muted"
            onCommit={NOOP}
          />
        </MetaRow>
        <MetaRowDivider />
        <MetaRow icon={UserRound} label="Creator">
          <Avatar
            person={memberPerson(creator)}
            size="xs"
            className="h-[20px] w-[20px] text-micro"
          />
          <span className="text-body text-text-primary">
            {memberLabel(creator)}
          </span>
        </MetaRow>
        <MetaRowDivider />
        <MetaRow icon={CalendarDays} label="Created">
          <span className="text-body text-text-primary">
            {formatDate(createdAt)}
          </span>
        </MetaRow>
      </InfoCardSection>

      {/* ⚠ ACTIVITY ABOVE MENTIONS AND ABOVE MEMBERS (Samuel, 2026-08-25, and
          2026-09-15 for Mentions' place): facts → what has been happening →
          what is addressed to YOU → who is here. The heading is
          `person-thread-activity.tsx`'s own word for this surface. */}
      <PanelHeading title="Channel activity" />
      <ThreadActivityStrip
        bins={activityBins}
        loading={false}
        metricLabel="Messages"
      />

      {/* ⚠ **A TOP-LEVEL CATEGORY, NOT A DISCLOSURE** (Samuel, 2026-09-15) —
          which is why /home renders `MentionsList` directly rather than
          `MentionsDisclosure`. 🔒 `inset="flush"` (Samuel, 2026-09-17): the rows
          start on this column's own edge, not on a disclosure's 28px hang. */}
      <PanelHeading title="Mentions" />
      <MentionsList
        mentions={mentions}
        truncated={false}
        loading={false}
        channelName={channelName}
        index={index}
        onOpenMention={NOOP}
        onMarkAllRead={NOOP}
        inset="flush"
      />

      {/* ⚠ THE ROWS ARE THE CHANNELS PAGE'S ROWS — literally, not approximately
          (Samuel, 2026-08-25: *"I don't know why you're making it different"*).
          ⚠ THE HEADING CARRIES THE COUNT AND NOTHING ELSE. */}
      <PanelHeading
        title="Members"
        trailing={
          <span className="text-caption text-text-muted">{members.length}</span>
        }
      />
      <div data-testid="channel-members">
        <MemberRoster members={members} viewerUserId={index.currentUserId} />
      </div>
      {/* ⚠ ADD PERSON LIVES *UNDER* THE ROSTER, with NO HEADING (Samuel,
          2026-08-25): the control says what it does. The FACE is
          `PAGE_ACTION_BTN` by import — /home's own black pill — and it is a
          `<span>` because this pane is decorative and `aria-hidden`. */}
      <div className="px-3.5 pt-2.5">
        <span className={PAGE_ACTION_BTN}>Add person</span>
      </div>
    </div>
  );
}

"use client";

/**
 * Channels — the sidebar's row shells.
 *
 * Split out of `sidebar.tsx` at design time rather than when lint asked
 * (INVARIANTS §1): the column is a LIST OF SECTIONS and a SET OF ROW FACES, and
 * those two change for different reasons — a new section is a layout edit, a
 * new row face is a design edit.
 */

import { Bot, CornerDownRight, Hash } from "lucide-react";
import { Avatar, type AvatarPerson } from "@/shared/ui/avatar";
import { AvatarStack } from "@/shared/ui/avatar-stack";
import { cn } from "@/shared/lib/utils";
import { CountBadge, IconTile } from "./bits";
// ⚠ THE SAME MARKS /home DRAWS (R-28), never a second pill and never a second dot.
import {
  LinkOutChip,
  MentionBadge,
  UnreadDot,
} from "@/shared/ui/home-card-marks";
import type { HomeChannelRowFace } from "@/shared/ui/home-channel-row";
import type { ChannelThread } from "../types";

/** The roster sample a row shows, and the size it shows it at. ⚠ `2xs` (20px)
 *  and `max={3}` are /home's own numbers (`home-channel-row.tsx`) — the same
 *  sample on both surfaces, so a row that says "three people and +2" says it
 *  once. ⚠ `2xs` also keeps this row at its 36px: `xs` grows it. */
const FACE_SIZE = "2xs" as const;
const FACE_MAX = 3;

const DEPTH_PAD = ["pl-2", "pl-5"] as const;

/**
 * The shared row shell: fixed height, glyph gutter, trailing badge slot.
 *
 * ⚠ NOT EXPORTED since 2026-08-19. `sidebar.tsx` was its one outside consumer,
 * for the hardcoded Favorites rows; that section renders real `ChannelRow`s now
 * and nothing outside this file composes the bare shell. Re-export it when a
 * second file needs a row face — not before, or `npx knip` grows another entry
 * nobody can tell from a real one.
 */
function SidebarRow({
  label,
  active,
  indent = 0,
  trailingPad = false,
  onClick,
  children,
}: {
  label: string;
  active?: boolean;
  indent?: 0 | 1;
  /** Reserve the right edge for a SIBLING control laid over it — see
   *  `ChannelRow`'s `reserveTrailing`. */
  trailingPad?: boolean;
  onClick?: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      aria-current={active ? "true" : undefined}
      onClick={onClick}
      className={cn(
        "flex h-[36px] w-full items-center gap-2 rounded-[8px] text-left text-small text-text-secondary transition-colors",
        trailingPad ? "pr-8" : "pr-2",
        DEPTH_PAD[indent],
        active
          ? "raised-tab font-medium text-text-primary"
          : "hover:bg-surface-raised-1 hover:text-text-primary"
      )}
    >
      {children}
    </button>
  );
}

/**
 * A channel or DM row.
 *
 * 🔒 **THE `@ N` MENTION BADGE IS HERE SINCE R-28 (Samuel, 2026-09-17: *mention
 * badges YES on workspace rows*), AND THE OLD REFUSAL IS WHY IT TOOK A RULING.**
 * This row said NO UNREAD BADGE because `Channel.unread` is a BOOLEAN and **a badge
 * is a claim about HOW MUCH is waiting**. R-28 did not overturn that rule; it
 * BOUGHT THE COUNT (`Channel.mentionCount`, a server aggregate on every row since
 * R-26), so the rule stands unchanged: **a numeric badge only where a real count
 * exists.**
 *
 * ⚠ **IT IS `home-card-marks.tsx › MentionBadge`, THE SAME MARK /home DRAWS** — one
 * statement across both surfaces, not a second pill.
 * ⚠ **AND IT IS THE DOT'S ALTERNATIVE, NOT ITS COMPANION**: a channel with unread
 * mentions already says the louder thing, and two markers read as two facts.
 *
 * 🔒 **THE DOT AND THE "Link out" CHIP COME FROM THE SAME MODULE SINCE WAVE 4.**
 * The dot was a hand-cut span here — its own geometry, its own accessible name
 * and its own colour — and the chip existed only inside `home-channel-row.tsx`.
 * Both are `home-card-marks.tsx` now: **one implementation per mark, two inks.**
 * `tone="link"` keeps this picker's blue (R-03), which is why the move is not a
 * port of /home's card.
 *
 * 🔒 **THE ROSTER RIDES THIS ROW SINCE WAVE 4 (U28), AS `AvatarStack` — THE MARK
 * /home ALREADY DRAWS, NOT A NEW ONE.** Same fact, same projection field, same
 * derivation (`lib/channel-display.ts › channelRowFaces`); only the LAYOUT is
 * this surface's own.
 * ⚠ **THE DM SECTION'S ROWS ARE PEOPLE** — a person is already a face in the
 * LEADING slot, so tiling them again on the right is one fact claimed twice.
 * ⚠ **NO PRESENCE RING, AND THAT IS THE MEASUREMENT RATHER THAN AN OMISSION.**
 * `AvatarStack` has an `online` key and `Channel` carries no PER-PEER presence —
 * only `onlineMemberCount`, a total. A ring driven by a total would say a named
 * person is here when the payload does not know that. `AvatarWithPresence` (the
 * roster panes) reads a real per-member signal; this row does not have one.
 */
export function ChannelRow({
  label,
  person,
  faces,
  linkOut = false,
  selected,
  unread,
  mentions = 0,
  reserveTrailing = false,
  onSelect,
}: {
  label: string;
  /** Present for a DM (the resolved peer); null for a normal channel. */
  person: AvatarPerson | null;
  /** EVERYBODY ELSE IN THE CHANNEL — `Channel.peers` through
   *  `lib/channel-display.ts › channelRowFaces`. IGNORED on a DM row (docblock).
   *  ⚠ **`?? EMPTY_PEERS` AT THE CALL SITE (§8)** — this row takes answers. */
  faces?: readonly HomeChannelRowFace[];
  /** An invitation is out on this channel — `Channel.linkOut !== null`, the
   *  SAME fact /home's row chips, judged by the same claim-gate predicate. */
  linkOut?: boolean;
  selected: boolean;
  unread: boolean;
  /**
   * `Channel.mentionCount`. ⚠ **`?? 0` AT THE CALL SITE (INVARIANTS §8)** — a new
   * key on an IndexedDB-persisted payload, and `0` hides the pill rather than
   * printing `@ NaN`.
   */
  mentions?: number;
  /**
   * Leave room at the row's right edge for a control that is NOT part of this
   * button (2026-08-20: the thread disclosure, `sidebar.tsx › ChannelBranch`).
   *
   * ⚠ IT RESERVES SPACE AND RENDERS NOTHING, deliberately. A control nested
   * INSIDE this row would be a button inside a button — invalid HTML, and a
   * click target a screen reader cannot describe separately. The disclosure is
   * a SIBLING positioned over the reserved space; all this row owes it is the
   * padding, so the label truncates before it collides.
   */
  reserveTrailing?: boolean;
  onSelect: () => void;
}) {
  // A DM row's leading slot IS this person's face — see the docblock.
  const stack = person ? [] : (faces ?? []);
  // The badge SUPPRESSES the dot rather than joining it (docblock).
  const mark =
    mentions > 0 ? (
      <MentionBadge count={mentions} />
    ) : unread ? (
      <UnreadDot tone="link" />
    ) : null;
  // ⚠ ONE TRAILING GROUP, AND IT IS ABSENT WHEN IT HOLDS NOTHING — the row's own
  // `gap-2` would otherwise pad every quiet channel by an empty span's gutter.
  const trailing =
    stack.length > 0 || linkOut || mark ? (
      <span className="ml-auto flex shrink-0 items-center gap-1.5">
        {linkOut && <LinkOutChip />}
        <AvatarStack size={FACE_SIZE} max={FACE_MAX} users={stack} />
        {mark}
      </span>
    ) : null;
  return (
    <SidebarRow
      label={label}
      active={selected}
      trailingPad={reserveTrailing}
      onClick={onSelect}
    >
      {person ? (
        <Avatar
          person={person}
          size="xs"
          className="h-[26px] w-[26px] text-caption"
        />
      ) : (
        <IconTile>
          <Hash size={14} />
        </IconTile>
      )}
      <span className={cn("truncate", unread && !selected && "font-semibold text-text-primary")}>
        {label}
      </span>
      {/* ⚠ THE ASK BADGE SHARED THIS CORNER UNTIL 2026-08-22 and is DELETED with
          the rest of the inbound consent lane (Samuel) — it counted threads
          awaiting the viewer's ANSWER, a question the product no longer asks. */}
      {trailing}
    </SidebarRow>
  );
}

/**
 * A nested thread row.
 *
 * Its two glyphs sit BARE on the sidebar surface — no `IconTile` — because a
 * tile is a button face, and a thread is a CHILD of the row above it, not a
 * peer control: the elbow says "under this", the `Bot` says an agent is party
 * to it (a display claim, same rule as the transcript's chip).
 *
 * ⚠ THE SECOND GLYPH USED TO BE A STATE AND IS NOW A CONSTANT (Samuel,
 * 2026-08-22). `Clock` + `text-warning` + the accessible name "— awaiting your
 * approval" marked a thread this viewer had a live `pending` inbound consent row
 * against. That lane is retired: there is no approval to await, so there is no
 * state to switch on. `Bot` is what every thread row wears.
 */
export function ThreadRow({
  thread,
  selected,
  onOpen,
}: {
  thread: ChannelThread;
  selected: boolean;
  onOpen: () => void;
}) {
  return (
    <SidebarRow
      label={thread.title}
      active={selected}
      indent={1}
      onClick={onOpen}
    >
      <span
        aria-hidden
        className="flex shrink-0 items-center gap-1 text-text-muted"
      >
        <CornerDownRight size={13} />
        <Bot size={13} />
      </span>
      <span className="truncate">{thread.title}</span>
    </SidebarRow>
  );
}

/** A quiet nav row: tile glyph, label, optional trailing count. */
export function NavRow({
  label,
  icon: Icon,
  badge,
  trailing,
  active,
  onClick,
}: {
  label: string;
  icon: React.ComponentType<{ size?: number }>;
  /** Rendered ONLY when a real count exists. */
  badge?: number;
  trailing?: React.ReactNode;
  /** Whatever the center pane is showing wears `.raised-tab` — the same
   *  selection rule the channel and thread rows follow (MAPPING, 2026-08-17). */
  active?: boolean;
  onClick?: () => void;
}) {
  return (
    <SidebarRow label={label} active={active} onClick={onClick}>
      <IconTile>
        <Icon size={14} />
      </IconTile>
      <span className="truncate">{label}</span>
      {trailing}
      {badge !== undefined && <CountBadge value={badge} />}
    </SidebarRow>
  );
}

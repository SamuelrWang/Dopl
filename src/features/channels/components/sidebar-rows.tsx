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
import { cn } from "@/shared/lib/utils";
import { CountBadge, IconTile } from "./bits";
// ⚠ THE SAME MARK /home DRAWS (R-28), never a second pill.
import { MentionBadge } from "@/shared/ui/home-card-marks";
import type { ChannelThread } from "../types";

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
 * This row said NO UNREAD BADGE for a stated reason: `Channel.unread` is a
 * BOOLEAN, the mock drew a count, and **a badge is a claim about HOW MUCH is
 * waiting** — inventing one from a boolean is the defect, not the omission. R-28
 * did not overturn that rule; it BOUGHT THE COUNT. `Channel.mentionCount` is a
 * server aggregate on every row of both scopes (Wave 3, R-26), so the badge now
 * has a real number behind it and the rule stands unchanged: **a numeric badge
 * only where a real count exists.**
 *
 * ⚠ **IT IS `home-card-marks.tsx › MentionBadge`, THE SAME MARK /home DRAWS**, not
 * a second pill — the count and its ink are one statement across both surfaces.
 * ⚠ **AND IT IS THE DOT'S ALTERNATIVE, NOT ITS COMPANION** (the design's own
 * rule, which `UnreadDot`'s docblock states): a channel with unread mentions
 * already says the louder thing, and two markers for one fact reads as two facts.
 *
 * ⚠ The DM section's rows are people; a person is already a face, so they are
 * never tiled.
 */
export function ChannelRow({
  label,
  person,
  selected,
  unread,
  mentions = 0,
  reserveTrailing = false,
  onSelect,
}: {
  label: string;
  /** Present for a DM (the resolved peer); null for a normal channel. */
  person: AvatarPerson | null;
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
          the rest of the inbound consent lane (Samuel). It counted threads in
          this channel awaiting the viewer's ANSWER — a question the product no
          longer asks, so the count had nothing true left to say. The unread dot
          is what remains, and it means what it always did: something here is
          newer than your `lastReadAt`. */}
      {mentions > 0 ? (
        <span className="ml-auto">
          <MentionBadge count={mentions} />
        </span>
      ) : (
        unread && (
          <span
            aria-label="Unread messages"
            className="ml-auto h-1.5 w-1.5 shrink-0 rounded-full bg-link"
          />
        )
      )}
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

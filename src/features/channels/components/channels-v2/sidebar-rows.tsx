"use client";

/**
 * Channels v2 — the sidebar's row shells.
 *
 * Split out of `sidebar.tsx` at design time rather than when lint asked
 * (INVARIANTS §1): the column is a LIST OF SECTIONS and a SET OF ROW FACES, and
 * those two change for different reasons — a new section is a layout edit, a
 * new row face is a design edit.
 */

import { Bot, Clock, CornerDownRight, Hash } from "lucide-react";
import { Avatar, type AvatarPerson } from "@/shared/ui/avatar";
import { cn } from "@/shared/lib/utils";
import { CountBadge, IconTile } from "./bits";
import type { ChannelThread } from "../../types";

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
 * ⚠ NO UNREAD BADGE. `Channel.unread` is a BOOLEAN — "something newer than my
 * `lastReadAt`" — and the mock drew a count. A badge is a claim about HOW MUCH
 * is waiting, and there is no such number in the read (wiring plan: unread
 * badges only where a real count exists, else omit). The DM section's rows are
 * people; a person is already a face, so they are never tiled.
 */
export function ChannelRow({
  label,
  person,
  selected,
  unread,
  askCount = 0,
  reserveTrailing = false,
  onSelect,
}: {
  label: string;
  /** Present for a DM (the resolved peer); null for a normal channel. */
  person: AvatarPerson | null;
  selected: boolean;
  unread: boolean;
  /**
   * Threads in this channel awaiting THIS viewer's answer — the ASK SIGNAL
   * (Samuel, 2026-08-20). `0` renders nothing.
   *
   * ⚠ A REAL COUNT, which is why this row may carry a number at all: the
   * docblock above refuses an unread BADGE because `Channel.unread` is a
   * boolean and a badge is a claim about HOW MUCH. This is that claim, and it is
   * true — `view-model-requested.ts › pendingAsksByChannel` counts rows.
   */
  askCount?: number;
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
      {/* ⚠ ONE TRAILING GROUP, so the ask badge and the unread dot can both be
          present without fighting over `ml-auto` (2026-08-20). They mean
          different things and a channel can legitimately have both: the dot is
          "there is something newer than your `lastReadAt`", the badge is
          "somebody is waiting on your answer". */}
      {(askCount > 0 || unread) && (
        <span className="ml-auto flex shrink-0 items-center gap-1.5">
          {askCount > 0 && <AskBadge count={askCount} label={label} />}
          {unread && (
            <span
              aria-label="Unread messages"
              className="h-1.5 w-1.5 shrink-0 rounded-full bg-link"
            />
          )}
        </span>
      )}
    </SidebarRow>
  );
}

/**
 * THE ASK SIGNAL — threads in this channel awaiting THIS viewer's answer
 * (Samuel's ruling, 2026-08-20: option (a), a per-channel count).
 *
 * ⚠ SAME GEOMETRY AS `CountBadge` AND THE SEGMENTED CONTROL'S COUNT PILL — 16px
 * stadium, micro semibold — and a FILLED tone rather than that badge's muted
 * one. The geometry is shared because a count is a count; the fill is not,
 * because this is the only number in the column that is a REQUEST rather than a
 * total. The Inbox row's badge stays muted deliberately: it answers "how many
 * are waiting" for a destination the operator chooses to visit, while this one
 * appears unasked-for beside a channel they were not looking at.
 * ⚠ It is distinct from the unread dot by SHAPE as well as tone — a count, not a
 * dot — which is the distinction Samuel's ruling asked for. The two can appear
 * together and mean different things.
 *
 * ⚠ IT CARRIES ITS OWN ACCESSIBLE NAME. The count alone reads as a bare number
 * beside a channel name, which is exactly as informative as the dot it must not
 * be confused with.
 */
function AskBadge({ count, label }: { count: number; label: string }) {
  return (
    <span
      role="status"
      aria-label={`${count} awaiting your answer in ${label}`}
      className="inline-flex h-[16px] min-w-[16px] shrink-0 items-center justify-center rounded-full bg-surface-cta px-1.5 text-micro font-semibold text-text-on-cta"
    >
      {count}
    </span>
  );
}

/**
 * A nested thread row.
 *
 * Its two glyphs sit BARE on the sidebar surface — no `IconTile` — because a
 * tile is a button face, and a thread is a CHILD of the row above it, not a
 * peer control: the elbow says "under this", the second glyph says what state
 * it is in (a display claim, same rule as the transcript's chip).
 *
 * ⚠ BOTH GLYPHS ARE BACK AND BOTH ARE DERIVED (wiring plan Phase 3). `Clock` =
 * REQUESTED — this viewer has a live `pending` consent request against this
 * thread (`view-model-requested.ts › requestedThreadIds`, off the consent inbox
 * the page already reads). `Bot` = everything else: an agent is party to it.
 * Same shape as the card's `PendingChip`, so one glyph means "waiting on
 * approval" in both columns (the port's intent doc § Sidebar glyph legend,
 * deleted at the Phase 12 cutover).
 *
 * ⚠ `requested` is the VIEWER's own state and cannot be anybody else's — a
 * consent read is scoped to `(operator, workspace)` (INVARIANTS §6). A thread
 * the viewer REQUESTED never wears the clock, however long its addressee takes.
 */
export function ThreadRow({
  thread,
  selected,
  requested,
  onOpen,
}: {
  thread: ChannelThread;
  selected: boolean;
  /** The viewer has been asked about this thread and has not answered. */
  requested: boolean;
  onOpen: () => void;
}) {
  const StateGlyph = requested ? Clock : Bot;
  return (
    <SidebarRow
      label={
        requested ? `${thread.title} — awaiting your approval` : thread.title
      }
      active={selected}
      indent={1}
      onClick={onOpen}
    >
      <span
        aria-hidden
        className={cn(
          "flex shrink-0 items-center gap-1",
          requested ? "text-warning" : "text-text-muted"
        )}
      >
        <CornerDownRight size={13} />
        <StateGlyph size={13} />
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

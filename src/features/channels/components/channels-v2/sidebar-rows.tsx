"use client";

/**
 * Channels v2 — the sidebar's row shells.
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
import type { ChannelThread } from "../../types";

const DEPTH_PAD = ["pl-2", "pl-5"] as const;

/** The shared row shell: fixed height, glyph gutter, trailing badge slot. */
export function SidebarRow({
  label,
  active,
  indent = 0,
  onClick,
  children,
}: {
  label: string;
  active?: boolean;
  indent?: 0 | 1;
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
        "flex h-[36px] w-full items-center gap-2 rounded-[8px] pr-2 text-left text-small text-text-secondary transition-colors",
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
  onSelect,
}: {
  label: string;
  /** Present for a DM (the resolved peer); null for a normal channel. */
  person: AvatarPerson | null;
  selected: boolean;
  unread: boolean;
  onSelect: () => void;
}) {
  return (
    <SidebarRow label={label} active={selected} onClick={onSelect}>
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
      {unread && (
        <span
          aria-label="Unread messages"
          className="ml-auto h-1.5 w-1.5 shrink-0 rounded-full bg-link"
        />
      )}
    </SidebarRow>
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
 * ⚠ ONE GLYPH, not the mock's two. `Bot` = an agent is party to it. The mock's
 * `Clock` meant REQUESTED — a thread addressed and waiting on consent — and
 * that is a mock-side status with no server-side existence (MAPPING.md § New
 * agent thread): server-side it is an open thread whose consent rows are still
 * pending, and nothing projects that until Phase 3. A glyph that cannot be
 * derived is not drawn.
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
      <span aria-hidden className="flex shrink-0 items-center gap-1 text-text-muted">
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
  onClick,
}: {
  label: string;
  icon: React.ComponentType<{ size?: number }>;
  /** Rendered ONLY when a real count exists. */
  badge?: number;
  trailing?: React.ReactNode;
  onClick?: () => void;
}) {
  return (
    <SidebarRow label={label} onClick={onClick}>
      <IconTile>
        <Icon size={14} />
      </IconTile>
      <span className="truncate">{label}</span>
      {trailing}
      {badge !== undefined && <CountBadge value={badge} />}
    </SidebarRow>
  );
}

"use client";

/** Small presentational pieces shared by the channel page's columns. */

import type { ReactNode } from "react";
import { Bot, Check, ChevronDown, ChevronRight, X, type LucideIcon } from "lucide-react";
import { CHIP } from "@/shared/ui/wells";
import { SMALL_TEXT_BUTTON } from "@/shared/ui/small-action-button";
import { PAGE_ACTION_BTN, PAGE_ACTION_BTN_LIGHT } from "@/shared/ui/page-action-button";
import { cn } from "@/shared/lib/utils";
import { IconButton } from "./icon-button";
export { IconButton };

/** A card's action ("Open thread", "Open") — {@link SMALL_TEXT_BUTTON} plus centring and disabled ink;
 *  always on the card's last row, right-aligned. */
export const CARD_BUTTON = cn(
  SMALL_TEXT_BUTTON,
  "cursor-pointer justify-center disabled:cursor-default disabled:text-text-muted disabled:hover:bg-transparent"
);

/** A right-panel tab's own action ("New thread", "Launch agent") at the 36px dark scale. Split controls use
 *  {@link TAB_ACTION_SHELL} + {@link TAB_ACTION_INK} (pinned against the whole by bits-tab-action.test.ts). */
export const TAB_ACTION = cn(PAGE_ACTION_BTN, "shrink-0 gap-1");
/** {@link TAB_ACTION}'s white twin. */
export const TAB_ACTION_LIGHT = cn(PAGE_ACTION_BTN_LIGHT, "shrink-0 gap-1");
/** The face and the box: elevation, 36px height, stadium ends. */
export const TAB_ACTION_SHELL = "auth-btn-3d flex h-9 rounded-full";
/** The label's own type, pad and ink — everything inside the shell. */
export const TAB_ACTION_INK = "gap-1 px-[15px] text-small font-semibold text-text-on-cta";

/** The right panel's card face (thread cards and agent cards). */
export const PANEL_CARD = "bento flex flex-col gap-2 px-3 py-2.5";

/** The raised square behind a sidebar row's glyph. `pointer-events-none` suppresses `.btn-light`'s hover
 *  lift so the row stays the only hover target. */
export function IconTile({ children }: { children: ReactNode }) {
  return (
    <span
      aria-hidden
      className="btn-light pointer-events-none flex h-[26px] w-[26px] shrink-0 items-center justify-center rounded-[7px] text-caption text-text-secondary"
    >
      {children}
    </span>
  );
}

/** Agent chip faces, deliberately off the severity ramp (an identity has no status). Index 0 is the plain
 *  face {@link AgentChip} wears. */
const AGENT_ACCENTS = [
  "border-border-strong bg-bg-inset text-text-secondary",
  "border-link/25 bg-link/10 text-link",
  "border-accent-primary/25 bg-accent-primary/10 text-accent-primary",
  "border-surface-cta bg-surface-cta text-text-on-cta",
] as const;

/** Agent id → one of {@link AGENT_ACCENTS} by a pure hash (stable across reloads); a hint, not a guarantee
 *  of distinctness. */
export function agentAccent(agentId: string): string {
  let hash = 0;
  for (let i = 0; i < agentId.length; i += 1) {
    hash = (hash * 31 + agentId.charCodeAt(i)) >>> 0;
  }
  return AGENT_ACCENTS[hash % AGENT_ACCENTS.length];
}

/** The bare "Agent" marker — a display claim (`authorKind` is caller-assertable, INVARIANTS §5); it never
 *  names which agent. */
export function AgentChip({ className }: { className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center gap-1 rounded-full border px-1.5 py-px text-micro font-medium",
        AGENT_ACCENTS[0],
        className
      )}
    >
      <Bot size={11} aria-hidden />
      Agent
    </span>
  );
}

/** Right-aligned count pill on a nav row; render only where a real count exists. */
export function CountBadge({ value }: { value: number }) {
  return (
    <span className="ml-auto inline-flex h-[16px] min-w-[16px] shrink-0 items-center justify-center rounded-full bg-bg-inset px-1.5 text-micro font-semibold text-text-secondary">
      {value}
    </span>
  );
}

/** The "NEW" flag beside an unreleased nav entry. */
export function NewPill() {
  return (
    <span className="ml-auto inline-flex shrink-0 items-center rounded-full border border-link/25 bg-link/10 px-1.5 py-px text-micro font-semibold uppercase tracking-wide text-link">
      New
    </span>
  );
}


/** One addressed agent in the new-thread dialog, removable; each is an explicit addressee (INVARIANTS §5). */
export function AgentTargetPill({
  label,
  onRemove,
}: {
  label: string;
  onRemove: () => void;
}) {
  return (
    <span className={cn(CHIP, "inline-flex items-center gap-1.5 py-1 pr-1.5")}>
      <Bot size={12} aria-hidden className="shrink-0 text-text-secondary" />
      <span className="truncate text-caption">{label}</span>
      <button
        type="button"
        aria-label={`Remove ${label}`}
        title={`Remove ${label}`}
        onClick={onRemove}
        className="flex h-4 w-4 shrink-0 items-center justify-center rounded-full text-text-muted transition-colors hover:bg-surface-raised-2 hover:text-text-primary"
      >
        <X size={11} />
      </button>
    </span>
  );
}

/**
 * One party of a posted thread, not removable; flat on its card. `approved` is normally omitted: a missing
 * pending consent row does not distinguish approved from never-asked (INVARIANTS §6).
 */
export function AddresseePill({
  label,
  approved,
}: {
  label: string;
  approved?: boolean;
}) {
  return (
    <span
      className={cn(
        "inline-flex max-w-full items-center gap-1.5 rounded-full border border-border-strong bg-bg-inset px-2 py-0.5 text-caption font-medium",
        approved === false ? "text-text-muted" : "text-text-primary"
      )}
    >
      {approved === true && (
        <Check size={12} aria-hidden className="shrink-0 text-success" />
      )}
      <span className="truncate">{label}</span>
      {approved !== undefined && (
        <span className="sr-only">
          {approved ? " — approved" : " — awaiting approval"}
        </span>
      )}
    </span>
  );
}

/** Muted uppercase group header with a working collapse chevron and optional actions. */
export function SectionHeader({
  title,
  actions,
  open,
  onToggle,
  className,
}: {
  title: string;
  actions?: ReactNode;
  /** Omit together with `onToggle` for a non-collapsible header. */
  open?: boolean;
  onToggle?: () => void;
  className?: string;
}) {
  const collapsible = onToggle !== undefined;
  const Chevron = open === false ? ChevronRight : ChevronDown;
  return (
    <div className={cn("flex items-center gap-1 px-3 pb-1 pt-3", className)}>
      {collapsible ? (
        <button
          type="button"
          onClick={onToggle}
          aria-expanded={open !== false}
          className="flex min-w-0 flex-1 items-center gap-1 rounded-[6px] py-0.5 text-left transition-colors hover:text-text-primary"
        >
          <span className="truncate text-label font-semibold uppercase tracking-wide text-text-secondary">
            {title}
          </span>
        </button>
      ) : (
        <>
          <span className="text-label font-semibold uppercase tracking-wide text-text-secondary">
            {title}
          </span>
          <span className="flex-1" />
        </>
      )}
      {actions}
      {collapsible && (
        <Chevron aria-hidden size={13} className="shrink-0 text-text-muted" />
      )}
    </div>
  );
}

/** One right-panel metadata row: glyph, label, value. A taller row passes `className` rather than forking. */
export function MetaRow({
  icon: Icon,
  label,
  className,
  onRemove,
  children,
}: {
  icon: LucideIcon;
  label: string;
  className?: string;
  /** A hover × that removes the row from this card, not the underlying fact (`info-card.ts`). */
  onRemove?: () => void;
  children: ReactNode;
}) {
  return (
    <div
      className={cn(
        "group/meta flex h-9 items-center gap-2 rounded-[8px] px-2",
        className
      )}
    >
      <Icon size={14} className="shrink-0 text-text-muted" />
      {/* Operator-authored label (up to `info-card.ts › INFO_CARD_LABEL_MAX` chars) in a fixed-height row. */}
      <span className="min-w-0 truncate text-small text-text-secondary">{label}</span>
      <span className="flex-1" />
      <span className="flex min-w-0 items-center gap-1.5">{children}</span>
      {onRemove && (
        // Hover-only via opacity (no reflow); `focus-within` keeps it visible to keyboard users.
        <span className="shrink-0 opacity-0 transition-opacity focus-within:opacity-100 group-hover/meta:opacity-100">
          <IconButton
            icon={X}
            label={`Remove ${label} from this card`}
            // No size override: `bare` sets a 32px hit area (icon-button.tsx) that twMerge would shrink.
            bare
            size={13}
            className="-mr-1"
            onClick={onRemove}
          />
        </span>
      )}
    </div>
  );
}

/** Inset hairline between Main-info rows. */
export function MetaRowDivider() {
  return <div aria-hidden className="mx-2 border-t border-border-subtle" />;
}

/** Bold section title inside the right-hand info panel. */
export function PanelHeading({
  title,
  trailing,
}: {
  title: string;
  trailing?: ReactNode;
}) {
  return (
    /* Section spacing is top padding on the heading, so every panel that stacks sections inherits it. */
    <div className="flex items-center gap-2 px-3.5 pb-1.5 pt-6">
      <h2 className="text-body font-semibold text-text-primary">{title}</h2>
      {trailing}
    </div>
  );
}

/** Channel role chip (owner/member, INVARIANTS §5). `guest` is the workspace-level tell and wins: a
 *  link-claimed guest reads `member` at the channel. */
export function RolePill({ owner, guest }: { owner: boolean; guest?: boolean }) {
  const label = guest ? "Guest" : owner ? "Owner" : "Member";
  return (
    <span
      className={cn(
        "shrink-0 rounded-full border px-2 py-px text-micro font-medium",
        guest
          ? "border-border-strong bg-bg-inset text-text-muted"
          : owner
            ? "border-link/25 bg-link/10 text-link"
            : "border-border-strong bg-bg-inset text-text-secondary"
      )}
    >
      {label}
    </span>
  );
}

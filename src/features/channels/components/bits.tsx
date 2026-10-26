"use client";

/** Small presentational pieces shared by the channel page's columns. */

import type { ReactNode } from "react";
import { Bot, ChevronDown, ChevronRight, X, type LucideIcon } from "lucide-react";
import { CHIP } from "@/shared/ui/wells";
import { pillButton } from "@/shared/ui/pill-button";
import { cn } from "@/shared/lib/utils";
import { IconButton } from "./icon-button";
import { LABEL_TEXT } from "@/shared/ui/section-heading";
export { IconButton };

/** A right-panel tab's own action ("New thread", "Launch agent") at the 36px dark scale. Split controls use
 *  {@link TAB_ACTION_SHELL} + {@link TAB_ACTION_INK} (pinned against the whole by bits-tab-action.test.ts). */
export const TAB_ACTION = cn(pillButton("ink", "lg"), "shrink-0 gap-1");
/** {@link TAB_ACTION}'s white twin. */
export const TAB_ACTION_LIGHT = cn(pillButton("white", "lg"), "shrink-0 gap-1");
/** The face and the box: the ink pill at 36px, its pad moved onto each half. */
export const TAB_ACTION_SHELL = cn(pillButton("ink", "lg"), "gap-0 px-0");
/** One half's pad — everything inside the shell. */
export const TAB_ACTION_INK = "gap-1 px-3.75";

/** The white card of hairline-separated rows: the Tasks list and a task's subtasks. */
export const ROW_CARD = "white-card m-0 flex min-w-0 list-none flex-col px-3";
/** One {@link ROW_CARD} row: a hairline above every row but the first. */
export const ROW_CARD_ROW = "border-t border-border-default first:border-t-0";

/** The raised square behind a sidebar row's glyph. `pointer-events-none` suppresses `.btn-light`'s hover
 *  lift so the row stays the only hover target. */
export function IconTile({ children }: { children: ReactNode }) {
  return (
    <span
      aria-hidden
      className="btn-light pointer-events-none flex h-6.5 w-6.5 shrink-0 items-center justify-center rounded-tile text-caption text-text-secondary"
    >
      {children}
    </span>
  );
}

/** Agent chip faces, deliberately off the severity ramp (an identity has no status). */
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

/** Right-aligned count pill on a nav row; render only where a real count exists. */
export function CountBadge({ value }: { value: number }) {
  return (
    <span className="ml-auto inline-flex h-4 min-w-4 shrink-0 items-center justify-center rounded-full bg-bg-inset px-1.5 text-micro font-semibold text-text-secondary">
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
 * One party of a posted thread, not removable; flat on its card. It states no approval: a missing pending
 * consent row does not distinguish approved from never-asked (INVARIANTS §6).
 */
export function AddresseePill({ label }: { label: string }) {
  return (
    <span className="inline-flex max-w-full items-center rounded-full border border-border-strong bg-bg-inset px-2 py-0.5 text-caption font-medium text-text-primary">
      <span className="truncate">{label}</span>
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
          className="flex min-w-0 flex-1 items-center gap-1 rounded-sm py-0.5 text-left transition-colors hover:text-text-primary"
        >
          <span className="truncate text-label font-semibold uppercase tracking-wide text-text-secondary">
            {title}
          </span>
        </button>
      ) : (
        <>
          <span className={LABEL_TEXT}>
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
        "group/meta flex h-9 items-center gap-2 rounded-md px-2",
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

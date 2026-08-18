/**
 * Channels v2 — the small pieces the three columns share.
 *
 * Every recipe here is composed from the design-system tokens and kit classes
 * (docs/DESIGN-SYSTEM.md); nothing carries a hex, a raw px font size or a
 * hand-rolled shadow.
 */

import type { ReactNode } from "react";
import { Bot, Check, ChevronDown, Clock, X, type LucideIcon } from "lucide-react";
import { CHIP } from "@/shared/ui/wells";
import { cn } from "@/shared/lib/utils";
import type { RoleTone } from "./mock-data";

/**
 * The face of a CARD hanging under a message body — the link attachment and the
 * posted agent-thread card are the two. One `.bento` recipe, extracted when the
 * second caller arrived (2026-08-17) rather than copied: they are the same
 * object at two contents, and a fork would drift on the next width change.
 */
export const MESSAGE_CARD = "bento mt-1 w-full max-w-[460px] px-3 py-2.5";

/** The compact raised action on a message card ("Quick view", "Open thread"). */
export const CARD_BUTTON =
  "btn-light shrink-0 rounded-[8px] px-2.5 py-1.5 text-caption font-medium text-text-primary";

/**
 * The RIGHT PANEL's card face — one `.bento` at panel width. The Threads tab's
 * thread cards and the Agents tab's agent cards are the two callers; extracted
 * when the second arrived (2026-08-18) rather than copied, for the same reason
 * `MESSAGE_CARD` was: they are one object at two contents.
 */
export const PANEL_CARD = "bento flex flex-col gap-2 px-3 py-2.5";

/**
 * The small raised white square every sidebar row's glyph sits on.
 *
 * Face comes from the kit's `.btn-light` (the raised-white family, same
 * gradient/hairline as `.auth-btn-3d-light`) — no local shadow recipe.
 * `pointer-events-none` keeps the row the only hover target: `.btn-light`
 * carries a hover lift meant for real buttons, and a tile that jumps when the
 * cursor crosses it reads as a bug.
 *
 * Avatars are NOT tiled — a person is already a face; two nested rounded
 * shapes would be one shape too many.
 */
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

/** Marks a message or a thread as having an agent party to it. The UI TAGS the
 *  claim, it does not authenticate it (MAPPING.md § Message alignment). */
export function AgentChip({ className }: { className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center gap-1 rounded-full border border-border-strong bg-bg-inset px-1.5 py-px text-micro font-medium text-text-secondary",
        className
      )}
    >
      <Bot size={11} aria-hidden />
      Agent
    </span>
  );
}

/** Right-aligned unread/count pill on a nav or channel row. */
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

/**
 * Quiet square icon button — the one chrome affordance in every header, and
 * (with `active`) the one TOGGLE face.
 *
 * `active` wears `.raised-tab`, the app-wide selected face. Its resting hover
 * tint is on the NOT-active branch on purpose: `.raised-tab` supplies the fill
 * from `@layer components`, so an unconditional `hover:bg-*` from the utility
 * layer would flatten the gradient the moment the cursor crossed it
 * (docs/DESIGN-SYSTEM.md § `.raised-tab`).
 */
export function IconButton({
  icon: Icon,
  label,
  size = 15,
  active,
  onClick,
  className,
}: {
  icon: LucideIcon;
  label: string;
  size?: number;
  /** Omit for a plain button; pass a boolean to make it a toggle. */
  active?: boolean;
  onClick?: () => void;
  className?: string;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      aria-pressed={active}
      onClick={onClick}
      className={cn(
        "flex h-7 w-7 shrink-0 items-center justify-center rounded-[7px] transition-colors",
        active
          ? "raised-tab text-text-primary"
          : "text-text-secondary hover:bg-surface-raised-1 hover:text-text-primary",
        className
      )}
    >
      <Icon size={size} />
    </button>
  );
}

/**
 * One addressed agent in the composer's new-thread panel: a raised chip on an
 * inset body (the kit's `CHIP`), with an × that drops it from the request.
 *
 * Each pill is an EXPLICIT addressee, never a broadcast convenience — see
 * MAPPING.md § New agent thread. `AddresseePill` is its posted counterpart.
 */
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
 * One addressed agent on a POSTED thread card, carrying its member's consent
 * decision. Not removable — the composer's `AgentTargetPill` is the editable
 * one; this is the artifact that was already sent, and un-addressing somebody
 * after the fact is not a thing the transcript can do.
 *
 * Flat `bg-bg-inset` rather than the raised `CHIP`: this pill sits on a `.bento`
 * card, and the kit's chip rule is raised-on-inset / flat-on-card
 * (docs/DESIGN-SYSTEM.md § Patterns).
 *
 * The check is the member's approval; `Clock` is the pending face. The state is
 * also spelled out for screen readers — a colour and a 12px glyph are not a
 * label.
 */
export function AddresseePill({
  label,
  approved,
}: {
  label: string;
  approved: boolean;
}) {
  return (
    <span
      className={cn(
        "inline-flex max-w-full items-center gap-1.5 rounded-full border border-border-strong bg-bg-inset px-2 py-0.5 text-caption font-medium",
        approved ? "text-text-primary" : "text-text-muted"
      )}
    >
      {approved ? (
        <Check size={12} aria-hidden className="shrink-0 text-success" />
      ) : (
        <Clock size={12} aria-hidden className="shrink-0 text-text-muted" />
      )}
      <span className="truncate">{label}</span>
      <span className="sr-only">
        {approved ? " — approved" : " — awaiting approval"}
      </span>
    </span>
  );
}

/** Caution-toned state chip on a thread card ("Requested"). Deliberately NOT
 *  the green `StatusPill`: green reads as settled, and this is unsettled. */
export function PendingChip({ label }: { label: string }) {
  return (
    <span className="inline-flex shrink-0 items-center gap-1 rounded-full border border-caution/30 bg-caution/10 px-2 py-px text-micro font-medium text-caution">
      <Clock size={10} aria-hidden />
      {label}
    </span>
  );
}

/** Muted uppercase group header with a collapse chevron and optional actions. */
export function SectionHeader({
  title,
  actions,
  collapsible = true,
  className,
}: {
  title: string;
  actions?: ReactNode;
  collapsible?: boolean;
  className?: string;
}) {
  return (
    <div className={cn("flex items-center gap-1 px-3 pb-1 pt-3", className)}>
      <span className="text-label font-semibold uppercase tracking-wide text-text-secondary">
        {title}
      </span>
      <span className="flex-1" />
      {actions}
      {collapsible && (
        <ChevronDown size={13} className="shrink-0 text-text-muted" />
      )}
    </div>
  );
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
    <div className="flex items-center gap-2 px-3.5 pb-1.5 pt-4">
      <h2 className="text-body font-semibold text-text-primary">{title}</h2>
      {trailing}
    </div>
  );
}

const ROLE_TONE: Record<RoleTone, string> = {
  design: "border-link/25 bg-link/10 text-link",
  management: "border-border-strong bg-bg-inset text-text-secondary",
  development: "border-success/25 bg-success/10 text-success",
};

/** Role tint chip on a member row. Tints come from the palette's three usable
 *  identity colours (link / neutral / success) — the token set has no more. */
export function RolePill({ tone, label }: { tone: RoleTone; label: string }) {
  return (
    <span
      className={cn(
        "shrink-0 rounded-full border px-2 py-px text-micro font-medium",
        ROLE_TONE[tone]
      )}
    >
      {label}
    </span>
  );
}

/**
 * LIVENESS of one of my agents — a dot and a word, no pill chrome.
 *
 * Deliberately NOT `StatusPill`: that bordered green pill is the channel's
 * settled "Active" state and it would out-shout the agent label it sits beside.
 * Liveness changes on its own while you watch, so it gets the quietest possible
 * face that still reads at a glance. The word carries the state for anyone the
 * colour does not reach — a 6px dot is not a label.
 */
export function AgentLiveness({
  running,
  className,
}: {
  running: boolean;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center gap-1.5 text-caption font-medium",
        running ? "text-success" : "text-text-muted",
        className
      )}
    >
      <span
        aria-hidden
        className={cn(
          "h-1.5 w-1.5 rounded-full",
          running ? "bg-success" : "bg-text-disabled"
        )}
      />
      {running ? "Running" : "Idle"}
    </span>
  );
}

/** Green dot + label status pill ("Active"). */
export function StatusPill({ label }: { label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full border border-success/25 bg-success/10 px-2 py-px text-caption font-medium text-success">
      <span className="h-1.5 w-1.5 rounded-full bg-success" />
      {label}
    </span>
  );
}

/** Emoji reaction chip under a message. */
export function ReactionPill({
  emoji,
  count,
}: {
  emoji: string;
  count: number;
}) {
  return (
    <button
      type="button"
      className="inline-flex h-[22px] items-center gap-1 rounded-full border border-border-strong bg-bg-elevated px-2 text-caption font-medium text-text-secondary transition-colors hover:bg-bg-elevated-hover"
    >
      <span aria-hidden>{emoji}</span>
      {count}
    </button>
  );
}

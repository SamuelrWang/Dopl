"use client";

/**
 * Channels v2 — the small pieces the three columns share.
 *
 * Ported verbatim in FACE from the design-review mock
 * (`apps/desktop-ui/src/pages/channels-v2/bits.tsx`, 2026-08-18); every recipe
 * is composed from the design-system tokens and kit classes
 * (docs/DESIGN-SYSTEM.md) and nothing carries a hex, a raw px font size or a
 * hand-rolled shadow.
 *
 * `ReactionPill` did NOT survive the port and its absence is deliberate: emoji
 * reactions have no backing column of any kind, and inventing them would
 * attribute a reaction to a real person nobody made.
 *
 * `PendingChip` DID come back (wiring plan Phase 3), wired rather than
 * fixtured — see its own docblock for what "requested" is derived from and
 * whose view it is true in.
 */

import type { ReactNode } from "react";
import { Bot, Check, ChevronDown, ChevronRight, Clock, X, type LucideIcon } from "lucide-react";
import { CHIP } from "@/shared/ui/wells";
import { cn } from "@/shared/lib/utils";

// ⚠ `MESSAGE_CARD` STOOD HERE AND IS DELETED (2026-08-20). Its one caller was the
// posted agent-thread card, which moved to a dark-shell face on 2026-08-19 and
// said so in its own docblock — leaving a "one caller" constant with none.

/** The compact raised action on a message card ("Open thread"). */
export const CARD_BUTTON =
  "btn-light shrink-0 rounded-[8px] px-2.5 py-1.5 text-caption font-medium text-text-primary";

/**
 * The RIGHT PANEL's card face — one `.bento` at panel width. The Threads tab's
 * thread cards and the Agents tab's agent cards are the two callers: one object
 * at two contents, so the recipe is shared rather than copied.
 */
export const PANEL_CARD = "bento flex flex-col gap-2 px-3 py-2.5";

/**
 * The small raised white square every sidebar row's glyph sits on.
 *
 * Face comes from the kit's `.btn-light` — no local shadow recipe.
 * `pointer-events-none` keeps the row the only hover target: `.btn-light`
 * carries a hover lift meant for real buttons, and a tile that jumps when the
 * cursor crosses it reads as a bug.
 *
 * Avatars are NOT tiled — a person is already a face.
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

/**
 * Marks a message or a thread as having an agent party to it.
 *
 * ⚠ The UI TAGS the claim, it does not authenticate it. `authorKind` is
 * caller-assertable and scoped to one user (INVARIANTS §5) — this chip is a
 * DISPLAY claim about who typed, never about who they are. The side the row
 * hangs on comes from `author_user_id`, which the server stamps.
 */
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

/**
 * REQUESTED — a thread the viewer has been asked about and has not answered.
 *
 * ⚠ THERE IS NO `requested` STATUS ANYWHERE IN STORAGE, and this chip is not
 * quietly inventing one. Server-side the state is a live `pending`
 * `channel_consent_requests` row against the viewer (INVARIANTS §6); the join is
 * `view-model-requested.ts › requestedThreadIds`, off the consent inbox this
 * page already reads.
 *
 * ⚠ TRUE IN ONE DIRECTION ONLY. A consent read is scoped to
 * `(operator, workspace)`, so this can only ever say "YOU have not answered" —
 * never "your addressee has not answered". A requester's own card carries no
 * chip, and that is a missing projection, not a settled request (F-206).
 *
 * `Clock`, matching the sidebar's thread glyph: one shape means "waiting on
 * approval" in both columns (the port's intent doc § Sidebar glyph legend,
 * deleted at the Phase 12 cutover).
 */
export function PendingChip({ className }: { className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center gap-1 rounded-full border border-warning/25 bg-warning/10 px-1.5 py-px text-micro font-medium text-warning",
        className
      )}
    >
      <Clock size={11} aria-hidden />
      Requested
    </span>
  );
}

/** Right-aligned count pill on a nav row. ⚠ Only ever rendered where a REAL
 *  count exists — a badge is a claim about how much is waiting. */
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
  filled,
  onClick,
  className,
}: {
  icon: LucideIcon;
  label: string;
  size?: number;
  /** Omit for a plain button; pass a boolean to make it a toggle. */
  active?: boolean;
  /**
   * FILL the glyph. Separate from `active` on purpose: `active` is a CHROME
   * state (this control's surface is raised), `filled` is a claim about the
   * THING the glyph stands for — a filled bookmark reads as saved. The outline
   * is always drawn, so the glyph does not change size between states, which is
   * the same rule the knowledge card's bookmark follows
   * (`knowledge-v2/home/base-card.tsx`).
   */
  filled?: boolean;
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
      <Icon size={size} fill={filled ? "currentColor" : "none"} />
    </button>
  );
}

/**
 * One addressed agent in the composer's new-thread panel: a raised chip on an
 * inset body (the kit's `CHIP`), with an × that drops it from the request.
 *
 * Each pill is an EXPLICIT addressee, never a broadcast convenience
 * (INVARIANTS §5). `AddresseePill` is its posted counterpart.
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
 * One party of a POSTED thread, on its card. Not removable — the composer's
 * `AgentTargetPill` is the editable one; this is the artifact that was already
 * sent, and un-addressing somebody after the fact is not a thing the transcript
 * can do.
 *
 * Flat `bg-bg-inset` rather than the raised `CHIP`: this pill sits on a `.bento`
 * card, and the kit's chip rule is raised-on-inset / flat-on-card.
 *
 * ⚠ `approved` is OPTIONAL and normally OMITTED here. In the mock it was a
 * display simplification of a consent row; server-side, consent is per-target,
 * TTL'd and re-derived at consume time (INVARIANTS §6), and "no pending row"
 * does not distinguish approved from never-asked. Rendering a green check off
 * that would be a fabricated claim about somebody's decision, so until the
 * launch flow lands (wiring plan, Phase 8) the pill states the party and
 * nothing else.
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

/**
 * Muted uppercase group header with a WORKING collapse chevron and optional
 * actions.
 *
 * ⚠ The chevron was decorative in the mock. Samuel's 2026-08-18 ruling is that
 * every disclosure in the wired page functions, so the caller owns the open
 * flag and this renders a real `aria-expanded` button. `collapsible={false}`
 * (no `onToggle`) keeps a plain label for a section that cannot close.
 */
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

/**
 * ONE metadata row in the right-hand panel: a glyph, a label, and whatever
 * states the value on the right.
 *
 * ⚠ It was module-private in `info-tab.tsx` until 2026-08-19, when the SETTINGS
 * tab became a second caller — a labelled row with a control on the right is
 * exactly the same object, and a local copy over there is how two panels in one
 * column come to sit at different heights.
 *
 * `h-9` is the resting height (h-10 until 2026-08-19 — Samuel tightened the
 * Main-info rhythm); a row whose control needs more (a description line)
 * passes `className` rather than forking the recipe.
 */
export function MetaRow({
  icon: Icon,
  label,
  className,
  children,
}: {
  icon: LucideIcon;
  label: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <div className={cn("flex h-9 items-center gap-2 rounded-[8px] px-2", className)}>
      <Icon size={14} className="shrink-0 text-text-muted" />
      <span className="text-small text-text-secondary">{label}</span>
      <span className="flex-1" />
      <span className="flex items-center gap-1.5">{children}</span>
    </div>
  );
}

/**
 * Inset hairline between Main-info rows (Samuel, 2026-08-19). `mx-2` keeps it
 * off the panel edges — it separates the rows, it does not frame the box —
 * and with the flush `h-9` rows above and below it sits exactly midway
 * between their content lines.
 */
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
    <div className="flex items-center gap-2 px-3.5 pb-1.5 pt-4">
      <h2 className="text-body font-semibold text-text-primary">{title}</h2>
      {trailing}
    </div>
  );
}

/**
 * Role tint chip on a member row.
 *
 * ⚠ The mock tinted a JOB TITLE ("Design" / "Development") and the model has no
 * such field. What a channel roster actually carries is `ChannelRole` — owner
 * or member (INVARIANTS §5) — so that is what the chip states. Tints come from
 * the palette's usable identity colours; the token set has no more.
 */
export function RolePill({ owner }: { owner: boolean }) {
  return (
    <span
      className={cn(
        "shrink-0 rounded-full border px-2 py-px text-micro font-medium",
        owner
          ? "border-link/25 bg-link/10 text-link"
          : "border-border-strong bg-bg-inset text-text-secondary"
      )}
    >
      {owner ? "Owner" : "Member"}
    </span>
  );
}

/**
 * LIVENESS of one of my agents — a dot and a word, no pill chrome.
 *
 * Deliberately NOT `StatusPill`: that bordered green pill is the channel's
 * settled "Active" state and it would out-shout the agent label beside it. The
 * word carries the state for anyone the colour does not reach.
 */
export function AgentLiveness({
  running,
  detail = null,
  className,
}: {
  running: boolean;
  /**
   * The finer sentence, when this machine can say one
   * (`agents-model.ts › agentDetailLabel`). It REPLACES "Running" rather than
   * joining it — "Running · Thinking…" says one thing twice, and the dot already
   * carries the liveness.
   *
   * ⚠ ONLY OVER A RUNNING AGENT, enforced here rather than trusted from the
   * caller: a detail under an idle dot would be the card contradicting itself,
   * and this is the one component both the tab and the panel render through.
   * ⚠ PEER CARDS PASS NOTHING. The cross-machine wire carries the coarse state
   * only, by design (INVARIANTS §11) — there is no `detail` on a peer row to pass.
   */
  detail?: string | null;
  className?: string;
}) {
  const label = running ? (detail ?? "Running") : "Idle";
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
      {label}
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

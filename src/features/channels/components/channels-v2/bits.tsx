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
 */

import type { ReactNode } from "react";
import { Bot, Check, ChevronDown, ChevronRight, X, type LucideIcon } from "lucide-react";
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
 * THE FOUR CHIP FACES ONE AGENT ID CAN WEAR, and the reason there are exactly
 * these four (Samuel, 2026-08-22 — "it looks like one agent sending").
 *
 * ⚠ NONE OF THEM IS ON THE SEVERITY RAMP, and that exclusion is the whole design
 * constraint. `success` / `caution` / `warning` / `danger` are documented as an
 * ORDERED ramp (docs/DESIGN-SYSTEM.md), so keying an identity off them would
 * paint one of an operator's agents alarm-red and rank the rest — a status claim
 * about a thing that has no status. What is left in the token set that carries no
 * severity is the neutral chip face, `link`, `accent-primary` and one step of the
 * elevation ramp, and that is the entire pool. Four is therefore a MEASUREMENT,
 * not a design target.
 *
 * ⚠ INDEX 0 IS TODAY'S FACE, ON PURPOSE. An UNSTAMPED agent post keeps the plain
 * chip byte for byte (see {@link AgentChip}), and a stamped one that hashes to 0
 * must be indistinguishable from it — the accent says WHICH agent, never THAT
 * there is one.
 */
const AGENT_ACCENTS = [
  "border-border-strong bg-bg-inset text-text-secondary",
  "border-link/25 bg-link/10 text-link",
  "border-accent-primary/25 bg-accent-primary/10 text-accent-primary",
  // The CTA ink, at chip scale — the strongest of the four and the precedent is
  // this file's own: the sidebar's ask badge wore exactly this pair at exactly
  // this size until the inbound lane was retired.
  "border-surface-cta bg-surface-cta text-text-on-cta",
] as const;

/**
 * ONE AGENT ID → ONE OF {@link AGENT_ACCENTS}, deterministically.
 *
 * ⚠ STABLE ACROSS RELOADS, MACHINES AND RENDERS, because it is a pure function
 * of the id and nothing else — no counter, no order-of-appearance index, no
 * palette cursor. An operator who learns that `k3v7d2mq` is the blue one must
 * still be right after a refetch reorders the transcript.
 *
 * ⚠ IT IS A HINT, NOT A GUARANTEE OF DISTINCTNESS. Four faces over an 8-char
 * id space collide, and two agents on one thread can land on the same one — which
 * is exactly why the ID TEXT ships beside it rather than instead of it. The
 * accent makes the split glanceable; the id is what makes it TRUE.
 *
 * Exported for the test: a palette that quietly stopped being deterministic looks
 * identical in a screenshot.
 */
export function agentAccent(agentId: string): string {
  let hash = 0;
  for (let i = 0; i < agentId.length; i += 1) {
    hash = (hash * 31 + agentId.charCodeAt(i)) >>> 0;
  }
  return AGENT_ACCENTS[hash % AGENT_ACCENTS.length];
}

/**
 * Marks a message or a thread as having an agent party to it — and, when the
 * writer stamped which of the operator's agents it was, WHICH one.
 *
 * ⚠ The UI TAGS the claim, it does not authenticate it. `authorKind` is
 * caller-assertable and scoped to one user (INVARIANTS §5) — this chip is a
 * DISPLAY claim about who typed, never about who they are. The side the row
 * hangs on comes from `author_user_id`, which the server stamps.
 *
 * ⚠ `agentId` EXISTS BECAUSE MULTIPLAYER BROKE THE PLAIN CHIP (Samuel,
 * 2026-08-22). Two of one operator's agents posting into one thread both wore an
 * undifferentiated "Agent" pill under one account name, so a transcript with two
 * writers read as one. The id is the ONLY thing on the wire that tells them apart
 * — `agents-model.ts › parseAgentPostStamp` off the writer's own
 * `client_msg_id`, the same token `agentSentMessages` splits the panel's Sent
 * lane on (F-251).
 *
 * ⚠ ABSENT IS THE OLD CHIP, NOT A BLANK. An unstamped agent post (an older main,
 * an agent that supplied its own idempotency key, a machine-level courtesy post)
 * renders exactly what it always did. Inventing an id for it, or dropping the
 * chip because there is none, would both report "cannot say" as something else
 * (INVARIANTS §11).
 */
export function AgentChip({
  agentId = null,
  className,
}: {
  /** The stamped per-instance id, or `null` for an unattributed agent post. */
  agentId?: string | null;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center gap-1 rounded-full border px-1.5 py-px text-micro font-medium",
        agentId ? agentAccent(agentId) : AGENT_ACCENTS[0],
        className
      )}
    >
      <Bot size={11} aria-hidden />
      Agent
      {agentId && (
        <>
          {/* ⚠ The separator is decoration; the id is read out on its own so a
              screen reader says "Agent k3v7d2mq" rather than spelling a middot. */}
          <span aria-hidden>·</span>
          <span className="font-mono tracking-tight">{agentId}</span>
        </>
      )}
    </span>
  );
}

// ⚠ `PendingChip` STOOD HERE AND IS DELETED (Samuel, 2026-08-22). It said
// "Requested" over a `Clock` on a thread card whose inbound consent row was still
// `pending` — the whole vocabulary of being asked and owing an answer, which that
// ruling retired ("remove all the stuff about declining and approving of
// threads"). It went with the card's Decline / Launch agent pair,
// `thread-consent.tsx › ThreadAwaitingStrip`, the Inbox's inbound rows, the
// sidebar's `Clock` thread glyph and its per-channel ask badge. There is no
// `requested` state left to chip.

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
  disabled,
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
  /**
   * ⚠ IN FLIGHT, not "not allowed" (2026-08-21, the composer's New Agent icon).
   * A control this surface cannot offer at all is not RENDERED — that is the
   * feature-detection rule the whole bridge family follows, and a permanently
   * greyed glyph is indistinguishable from a broken one. This is for the moment
   * between a click and its answer.
   */
  disabled?: boolean;
  onClick?: () => void;
  className?: string;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      aria-pressed={active}
      disabled={disabled}
      onClick={onClick}
      className={cn(
        "flex h-7 w-7 shrink-0 items-center justify-center rounded-[7px] transition-colors",
        active
          ? "raised-tab text-text-primary"
          : "text-text-secondary hover:bg-surface-raised-1 hover:text-text-primary",
        disabled && "cursor-not-allowed opacity-50",
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

/** Green dot + label status pill ("Active"). */
export function StatusPill({ label }: { label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full border border-success/25 bg-success/10 px-2 py-px text-caption font-medium text-success">
      <span className="h-1.5 w-1.5 rounded-full bg-success" />
      {label}
    </span>
  );
}

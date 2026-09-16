"use client";

/**
 * Channels — the small pieces the three columns share. Every recipe composes
 * design-system tokens and kit classes (docs/DESIGN-SYSTEM.md); nothing here
 * carries a hex, a raw px font size or a hand-rolled shadow.
 *
 * ⚠ NO `ReactionPill`, deliberately: emoji reactions have no backing column of
 * any kind, and inventing them would attribute a reaction to a real person
 * nobody made.
 */

import type { ReactNode } from "react";
import { Bot, Check, ChevronDown, ChevronRight, X, type LucideIcon } from "lucide-react";
import { CHIP } from "@/shared/ui/wells";
import { SMALL_TEXT_BUTTON } from "@/shared/ui/small-action-button";
import { cn } from "@/shared/lib/utils";

/**
 * ⚠ `IconButton` LIVES IN `./icon-button.tsx` SINCE 2026-08-25 (the §1 split at
 * the `bare` variant) and is RE-EXPORTED here so every `from "./bits"` importer
 * is unchanged. Imported AS WELL AS re-exported — `MetaRow` mounts one, and
 * `export { … } from` binds no local name.
 */
import { IconButton } from "./icon-button";
export { IconButton };

/**
 * The action on a card ("Open thread", "Open", "Viewing").
 *
 * ⚠ TEXT-ONLY AT `--action-h-sm` SINCE 2026-09-08 (Samuel: *"can you make the
 * open button a little thinner, like we have another button UI … Make sure this
 * applies across the entire product"*, then *"just have it be the word open as
 * the button"*). It was `h-9 px-[15px] text-small`; 36px is {@link TAB_ACTION}'s
 * alone now.
 * ⚠ IT IS `shared/ui/small-action-button.ts › SMALL_TEXT_BUTTON` PLUS THE CARD'S
 * OWN CENTRING AND DISABLED INK — the scale and the hover live there, shared with
 * the composer's Discard and every popup form's, so one edit reaches all three.
 *
 * The POSITION is a contract this constant cannot enforce: every card puts its
 * action on the LAST row, right-aligned, so the eye finds the same control in
 * the same corner every time.
 */
export const CARD_BUTTON = cn(
  SMALL_TEXT_BUTTON,
  "cursor-pointer justify-center disabled:cursor-default disabled:text-text-muted disabled:hover:bg-transparent"
);

/**
 * THE RIGHT PANEL TAB'S OWN ACTION — top-right of a tab body, above its list
 * (Threads' "New thread", Agents' "Launch agent"; Samuel, 2026-08-24).
 *
 * ⚠ THE APP'S 36px CONTROL SCALE, DARK FACE — `h-9 px-[15px] text-small`,
 * /home's Invite geometry, because this IS that button. It was a 20px light
 * rectangle for one review and read as a chip nobody could find; do not shrink
 * it again. Since {@link CARD_BUTTON} dropped to 30px on 2026-09-08 a tab action
 * is the only thing left wearing this scale.
 *
 * ⚠ SPLIT INTO {@link TAB_ACTION_SHELL} + {@link TAB_ACTION_INK} SO THE SPLIT
 * BUTTON CAN COMPOSE IT. A split control is a wrapper plus two hit targets and
 * one class string cannot express that; the Agents tab used to re-cut the same
 * `h-9` / 15px pad / `text-small` by hand with a ⚠ saying it had to be re-cut
 * again whenever this moved. It composes the halves now, so it cannot drift.
 */
/** The face and the box: elevation, 36px height, stadium ends. */
export const TAB_ACTION_SHELL = "auth-btn-3d flex h-9 rounded-full";
/** The label's own type, pad and ink — everything inside the shell. */
export const TAB_ACTION_INK = "gap-1 px-[15px] text-small font-semibold text-text-on-cta";
export const TAB_ACTION = cn(
  TAB_ACTION_SHELL,
  "shrink-0 cursor-pointer items-center",
  TAB_ACTION_INK
);

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
 * THE FOUR CHIP FACES ONE AGENT ID CAN WEAR (Samuel, 2026-08-22 — "it looks like
 * one agent sending").
 *
 * ⚠ NONE OF THEM IS ON THE SEVERITY RAMP. `success`/`caution`/`warning`/`danger`
 * are an ORDERED ramp (docs/DESIGN-SYSTEM.md), so keying an identity off them
 * would paint one of an operator's agents alarm-red and rank the rest — a status
 * claim about a thing that has no status. What is left carrying no severity is the
 * neutral chip face, `link`, `accent-primary` and one elevation step: FOUR is a
 * measurement of the token set, not a design target.
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
 * ⚠ STABLE ACROSS RELOADS, MACHINES AND RENDERS — a pure function of the id and
 * nothing else, no counter and no order-of-appearance index. An operator who
 * learns that `k3v7d2mq` is the blue one must still be right after a refetch
 * reorders the transcript.
 *
 * ⚠ A HINT, NOT A GUARANTEE OF DISTINCTNESS. Four faces collide, so the ID TEXT
 * ships beside the accent rather than instead of it.
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
 * ⚠ IT SAYS "Agent" AND NOTHING ELSE — no `agentId` prop, dropped by the
 * 2026-08-27 sweep (INVARIANTS §11: the raw agent id is never user-visible).
 * WHICH agent is `attribution-pill.tsx › AttributionPill`'s question. The bare
 * noun is the honest reading, not a degradation: the row already names the
 * account, and "cannot say which" is what an inbox row genuinely knows.
 */
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

// ⚠ NO `PendingChip` — deleted with the whole inbound-consent vocabulary (Samuel,
// 2026-08-22: "remove all the stuff about declining and approving of threads").
// There is no `requested` state left to chip.

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
 * ⚠ `approved` is OPTIONAL and normally OMITTED. Consent is per-target, TTL'd and
 * re-derived at consume time (INVARIANTS §6), so "no pending row" does not
 * distinguish approved from never-asked — a green check off that would be a
 * fabricated claim about somebody's decision.
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
 * `h-9` is the resting height (Samuel tightened the Main-info rhythm from h-10 on
 * 2026-08-19); a row whose control needs more (a description line) passes
 * `className` rather than forking the recipe — a local copy is how two panels in
 * one column come to sit at different heights.
 */
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
  /**
   * REMOVE THIS ROW FROM THE CARD (Samuel, 2026-08-25). Omit for a fixed row —
   * absent means no ×, which is what every existing caller gets.
   *
   * ⚠ IT REMOVES THE ROW, NOT THE FACT. The email is still on the profile; what
   * the operator changed is what this card shows (`info-card.ts`). Word the
   * surrounding copy that way — an × that reads as "delete this person's email"
   * is a promise the write does not keep.
   */
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
      {/* ⚠ `min-w-0 truncate`: the label hosts operator-authored labels up to 40
          chars (`info-card.ts › INFO_CARD_LABEL_MAX`) in a fixed `h-9` row. */}
      <span className="min-w-0 truncate text-small text-text-secondary">{label}</span>
      <span className="flex-1" />
      <span className="flex min-w-0 items-center gap-1.5">{children}</span>
      {onRemove && (
        // ⚠ HOVER-ONLY, SPACE NOT RESERVED: a permanent × on every row turns a
        // card the reader GLANCES at into a form. `opacity`, not `hidden`, so
        // nothing reflows when the cursor arrives — and `focus-within` is the
        // keyboard half, because a Tab-reachable control that stays invisible
        // while focused is a trap.
        <span className="shrink-0 opacity-0 transition-opacity focus-within:opacity-100 group-hover/meta:opacity-100">
          <IconButton
            icon={X}
            label={`Remove ${label} from this card`}
            // ⚠ `bare` = the naked-glyph idiom, and NO `h-6 w-6`: it sizes the hit
            // area at 32px on purpose (icon-button.tsx), and twMerge would let an
            // override SHRINK it. Only the `-mr-1` alignment nudge rides along.
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
    /* ⚠ `pt-6`, UP FROM `pt-4` (Samuel, 2026-09-15: *"add slightly more spacing
       between the end of a section, and the header for the next section"*). It is
       TOP padding on the HEADING rather than bottom margin on each section, so the
       gap is stated once and every panel that stacks sections inherits it — the
       workspace Info tab, /home's, Threads, Agents. A margin per section would be
       the same number in five places, drifting.
       ⚠ The leading `pb-1.5` is untouched: the distance from a heading to ITS OWN
       rows is a different measurement and Samuel did not move it. */
    <div className="flex items-center gap-2 px-3.5 pb-1.5 pt-6">
      <h2 className="text-body font-semibold text-text-primary">{title}</h2>
      {trailing}
    </div>
  );
}

/**
 * Role tint chip on a member row.
 *
 * ⚠ IT STATES `ChannelRole` — owner or member (INVARIANTS §5). The mock tinted a
 * JOB TITLE and the model has no such field.
 *
 * ⚠ `guest` is the WORKSPACE-level tell, not a channel role — a link-claimed
 * guest reads `member` at the channel (§4A), so the operator would otherwise not
 * see whom they invited as a guest. It takes precedence over owner/member (a
 * guest is never a channel owner) and reads muted, the least-privileged look.
 */
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

/** Green dot + label status pill ("Active"). */
export function StatusPill({ label }: { label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full border border-success/25 bg-success/10 px-2 py-px text-caption font-medium text-success">
      <span className="h-1.5 w-1.5 rounded-full bg-success" />
      {label}
    </span>
  );
}

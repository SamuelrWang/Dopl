"use client";

import type { ReactNode } from "react";
import { cn } from "@/shared/lib/utils";
import { agentModelShortLabel } from "@/features/channels/lib/agent-models";
import { pendingRow } from "@/shared/ui/pending";
import { SectionPanel } from "@/shared/ui/section-panel";
import { SECTION_HEADING_TEXT } from "@/shared/ui/section-heading";
import { CARD_LIFT_CLASS } from "@/shared/ui/card-lift";
import type { AgentIdentity } from "../client/types";
import type { IdentitySectionDef } from "../lib/visibility";

/**
 * ONE scope panel and the cards inside it (Samuel's mock: three stacked gray
 * panels, each holding a grid of white cards).
 *
 * ⚠ THE PANEL FACE IS FLAT AND CONTAINED — `bg-card-surface-subtle` on a
 * hairline, the kit's "header strips, inset cards" token — and it is
 * deliberately NOT `SectionBox`. That pattern's BODY is `bg-bg-inset` plus the
 * concave inset shadow, and **Samuel's ruling for this page is that no surface
 * on it is pressed in** (2026-08-22). Raised, elevated and flat faces only: the
 * panel is flat, the cards on it are `.bento`, and the editor's fields are the
 * kit's RAISED well. A `.concave-field` / `.concave-track` / `SECTION_BOX_INSET`
 * anywhere under `features/agent-identities/` is a regression with a test behind
 * it (`identity-editor-surface.test.tsx › no concave surfaces`) — and since 2026-08-26
 * that sweep also reaches `apps/desktop-ui/src/pages/home/agent-*.tsx`, because
 * the /home Agents face reuses THIS module rather than growing a second panel
 * recipe (Q4, `home-agents-tab.plan.md` §0.6).
 *
 * ⚠ AN EMPTY SECTION KEEPS ITS HEADER and says one quiet line. A panel that
 * vanished when empty would make "you have no team identities" and "this
 * workspace has no teams" the same picture, and the create affordance sits at
 * page level precisely so no section has to grow one.
 *
 * ⚠ THREE PARTS, BECAUSE TWO SURFACES COMPOSE THEM DIFFERENTLY. The workspace
 * page stacks whole {@link IdentitySection}s; the /home pane needs the same
 * PANEL with a scope pill in its header and a body that can also say "in
 * flight" or "unavailable" — so the shell ({@link IdentityPanel}) and the grid
 * ({@link IdentityGrid}) are separately callable. **Neither surface forks the
 * class strings**, which is the whole point of the split.
 */

/**
 * The flat panel shell: heading and optional header control.
 *
 * ⚠ THE STRUCTURE IS `shared/ui/section-panel.tsx › SectionPanel` SINCE
 * 2026-08-27. The /home Knowledge sections were `SectionBox` (a header strip
 * over a CONCAVE body) until Samuel ruled the two /home faces onto one flat
 * rectangle; `SectionPanel` is the shape they share. ⚠ **AND SINCE R-38/R-39
 * (2026-09-17) IT IS ALSO THE GROUND** — the component paints one flat gray on
 * every host, /home's scoped repaint is deleted, and this file passes no
 * `className` at all.
 */
/**
 * THE IDENTITY CARD'S NAME TYPE — title size, medium weight, primary ink.
 * ⚠ EXPORTED (2026-09-13) because Samuel named THIS text as the reference for
 * the /home Overview's "Usage" heading and its scope menu ("extract that exact
 * font, font size, and font color and apply it"); one constant, two readers.
 */
export const IDENTITY_NAME_TEXT = "text-title font-medium text-text-primary";

/**
 * THE SAME NAME TYPE, ONE STEP UP THE SCALE AND BOLDER — `text-display` (18px)
 * and `font-semibold`, same ink.
 *
 * 🔒 **SAMUEL, 2026-09-13: *"increase the font size for usage … let's bold it as
 * well"*.** It began as the /home Overview's **Usage** heading alone.
 *
 * ⚠ **IT HAS NO READERS LEFT, AND THAT IS BECAUSE THE TRIAL WAS PROMOTED THE
 * SAME DAY.** Samuel then ruled the face onto EVERY section heading, so it lives
 * in `shared/ui/section-heading.ts › SECTION_HEADING_TEXT` and `SectionPanel`
 * applies it — the Usage heading included. This alias survives only as the NAME
 * three files argue against by (`channels/components/agent-window-frame.ts`,
 * `channels/components/recency-wells.tsx`, `pages/home/overview-usage-filter.tsx` all say
 * "not `IDENTITY_NAME_TEXT_LG`"); delete it together with those references, not
 * before them.
 *
 * ⚠ **IT WAS APPLIED TO FOUR THINGS FOR ONE PASS AND THREE OF THEM WERE A
 * MISREAD — Samuel, same day, rejecting it: *"You changed the font size of the
 * credit spend, all channels, and the date to the super large size, like usage. I
 * did not ask for that. I only asked you to change the usage size to be
 * bigger."*** The scope menu (**All channels**), the month label and the credit
 * card's **Credit spend** heading are on `IDENTITY_NAME_TEXT` — the 14px face —
 * and the month label was RAISED to it rather than to this one, which is the
 * whole of what *"the month switcher as well"* asked for. **The block has two
 * scales on purpose: the panel heading, then everything inside it.** Do not
 * widen this constant's readers without a ruling that names one.
 *
 * ⚠ **A STEP ON THE TOKEN SCALE, NEVER A PX** (`docs/DESIGN-SYSTEM.md` › Type
 * scale): `text-title` → `text-display` is the next utility, and there is
 * nothing between them to pick instead.
 *
 * ⚠ **IT SITS BESIDE `IDENTITY_NAME_TEXT` RATHER THAN OVERRIDING IT AT THE CALL
 * SITE.** The agent identity card keeps the smaller face — a card NAME in a list
 * is not a page heading — and a `cn(IDENTITY_NAME_TEXT, "text-display
 * font-semibold")` at the reader would be a same-layer fight with the constant it
 * is composing, which is how a heading silently keeps 14px.
 */
export const IDENTITY_NAME_TEXT_LG = SECTION_HEADING_TEXT;

/**
 * THE CARD GRID — FOUR to a row, FIXED (Samuel, 2026-09-13: *"I want to
 * increase width of cards so it's 4 per row"*, then over an auto-fill that gave
 * two: *"this is 2 on a row. I said 4 on a row"*). Not `auto-fill`: the count is
 * the ruling, the width follows. Exported so both Agents skeletons byte-share it.
 */
export const IDENTITY_GRID = "grid grid-cols-4 gap-2.5";

export function IdentityPanel({
  id,
  label,
  action,
  children,
}: {
  /** Id the heading carries, so the section is a NAMED region. */
  id: string;
  label: string;
  /** Header-right control (the /home face's scope pill). */
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <SectionPanel
      id={id}
      label={label}
      action={action}
      // ⚠ NO `className` SINCE R-38 (2026-09-17): the ground is the
      // component's default, and the last readers of the constant are the
      // loading ghosts.
    >
      {children}
    </SectionPanel>
  );
}

/** The card grid, or the one quiet line that stands in for it. */
export function IdentityGrid({
  identities,
  emptyLine,
  onOpen,
  pendingIds,
  markerFor,
  actionFor,
}: {
  identities: ReadonlyArray<AgentIdentity>;
  /** ⚠ Only ever rendered against a RESOLVED read — see `resolved` on
   *  `../hooks/use-agent-identities.ts`. Absent = an empty grid renders
   *  nothing. */
  emptyLine?: string;
  /** Absent = the cards are not openable on this surface yet (see
   *  {@link IdentityCard}). */
  onOpen?: (identity: AgentIdentity) => void;
  /** Rows with a write in flight — dimmed and inert via the kit's PENDING_ROW. */
  pendingIds?: ReadonlySet<string>;
  /** `by <member>` for a row this operator did not write, else `null`. */
  markerFor?: (identity: AgentIdentity) => string | null;
  /** A SECOND control for a row, under the body ({@link IdentityCard}). */
  actionFor?: (identity: AgentIdentity) => ReactNode;
}) {
  if (identities.length === 0) {
    return emptyLine ? (
      <p className="px-1 pb-1 text-caption text-text-muted">{emptyLine}</p>
    ) : null;
  }
  return (
    <div className={IDENTITY_GRID}>
      {identities.map((identity) => (
        <IdentityCard
          key={identity.id}
          identity={identity}
          onOpen={onOpen}
          pending={pendingIds?.has(identity.id) ?? false}
          marker={markerFor?.(identity) ?? null}
          action={actionFor?.(identity) ?? null}
        />
      ))}
    </div>
  );
}

export function IdentitySection({
  section,
  identities,
  onOpen,
  pendingIds,
}: {
  section: IdentitySectionDef;
  identities: ReadonlyArray<AgentIdentity>;
  onOpen: (identity: AgentIdentity) => void;
  pendingIds?: ReadonlySet<string>;
}) {
  return (
    <IdentityPanel
      id={`agent-identities-${section.visibility}`}
      label={section.label}
    >
      <IdentityGrid
        identities={identities}
        emptyLine={section.emptyLine}
        onOpen={onOpen}
        pendingIds={pendingIds}
      />
    </IdentityPanel>
  );
}

/**
 * One identity, as a card.
 *
 * ⚠ MINIMAL BY RULING (INVARIANTS §5): the NAME, a muted description line, and a
 * model chip only WHEN one is set. `agentModelShortLabel` returns `null` for an
 * unset model and that is not the same answer as "Default" — a card states what
 * an identity CARRIES, and a chip reading "Default" on every unset row would be
 * three words of chrome per card saying nothing.
 *
 * ⚠ THE WHOLE CARD IS THE AFFORDANCE — WHEN THERE IS ONE. `onOpen` absent
 * renders a plain `div`, not a dead `button`: a card that looks pressable and
 * does nothing is worse than one that does not invite the press. Both surfaces
 * pass one now (the /home face gained its editor in `home-agents-tab.plan.md`
 * M3), so the branch is kept for the next surface that lists identities it
 * cannot author. ⚠ **A row may carry ONE second control (`action`), and it goes
 * INSIDE the face rather than on top of it** — a `<button>` may not contain a
 * `<button>`, so an action turns the card into a `div` whose body is the button.
 * ⚠ **SINCE 2026-09-22 THE /home CARD'S ACTION IS A KNOWLEDGE BOX AND A LAUNCH**
 * (Samuel), superseding the note that stood here — *"no launch control …
 * a second launch surface fights `resolve`'s singularity"*. That argument was
 * about launch-time SELECTION, which is still the New-agent popup's alone; the
 * card launches an identity AS-IS and offers no choices at all
 * (`pages/home/identity-card-launch.tsx`). There is still no kebab and no per-card
 * delete.
 *
 * ⚠ THE AUTHORSHIP MARKER IS A SECURITY SIGNAL, NOT DECORATION
 * (`identity-picker.tsx › authorMarker`). An identity another member wrote
 * carries instructions the operator's agent will follow; the desktop wears a
 * different ROLE header for one (§5A), and the operator must be able to see the
 * same fact BEFORE it runs. It renders first, above the name.
 */
function IdentityCard({
  identity,
  onOpen,
  pending,
  marker,
  action,
}: {
  identity: AgentIdentity;
  onOpen?: (identity: AgentIdentity) => void;
  pending: boolean;
  marker: string | null;
  action: ReactNode;
}) {
  const model = agentModelShortLabel(identity.model);
  const description = identity.description?.trim();
  const body = (
    <>
      {marker && (
        <span className="w-fit shrink-0 rounded-full border border-border-strong bg-bg-elevated px-2 py-px text-micro font-medium text-text-muted">
          {marker}
        </span>
      )}
      {/* ⚠ NAME LEFT, MODEL PILL TOP-RIGHT, NO HAIRLINE ON THE PILL (Samuel,
          2026-09-13: "put the model pill to be on the top right of the box.
          Also no borderline around pill"). */}
      <span className="flex w-full items-start justify-between gap-2">
        <span className={cn("min-w-0 truncate", IDENTITY_NAME_TEXT)}>
          {identity.name}
        </span>
        {model && (
          <span className="shrink-0 rounded-full bg-bg-inset px-2 py-0.5 text-micro font-medium text-text-secondary">
            {model}
          </span>
        )}
      </span>
      {description && (
        <span className="line-clamp-2 text-caption leading-relaxed text-text-secondary">
          {description}
        </span>
      )}
    </>
  );
  const face = "bento flex min-h-[92px] flex-col gap-1.5 p-3 text-left";
  // ⚠ THE SHARED LIFT, NOT A LOCAL STRING (Samuel, 2026-09-21: the two card
  // faces "should have the same animation"). This face used to transition the
  // SHADOW ONLY and never move, which is the difference he saw. The Knowledge
  // card's `.card:hover` carries the same numbers; `card-lift.test.ts` pins the
  // pair bidirectionally, because a CSS module cannot import this constant.
  const raise = CARD_LIFT_CLASS;

  // ⚠ A SECOND CONTROL MOVES THE PRESSABLE ELEMENT *INSIDE* THE CARD, it does
  // not overlay one. A `<button>` may not contain a `<button>` — an absolutely
  // positioned action on top of a card-shaped button is invalid HTML that
  // renders, which is the worst kind — so when a row carries an action the FACE
  // becomes a plain `div` and the body is the button within it. The whole card
  // still opens the editor everywhere except the action's own footprint.
  if (action) {
    return (
      <div {...pendingRow(pending, cn(face, onOpen && raise))}>
        {onOpen ? (
          <button
            type="button"
            onClick={() => onOpen(identity)}
            className="flex flex-1 cursor-pointer flex-col items-start gap-1.5 text-left"
          >
            {body}
          </button>
        ) : (
          body
        )}
        {/* ⚠ **`mt-auto` AND FULL WIDTH SINCE 2026-09-22** (Samuel: the card's
            Launch control sits *"on the bottom right of the card"*, over a
            full-width knowledge box). The slot used to hug the body, so a short
            description floated the control halfway up the face and two cards in
            one row put their buttons at two heights. */}
        <div className="mt-auto w-full pt-1.5">{action}</div>
      </div>
    );
  }

  if (!onOpen) return <div {...pendingRow(pending, face)}>{body}</div>;
  return (
    <button
      type="button"
      onClick={() => onOpen(identity)}
      {...pendingRow(pending, cn(face, "cursor-pointer", raise))}
    >
      {body}
    </button>
  );
}

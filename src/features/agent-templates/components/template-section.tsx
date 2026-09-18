"use client";

import type { ReactNode } from "react";
import { cn } from "@/shared/lib/utils";
import { agentModelShortLabel } from "@/features/channels/lib/agent-models";
import { pendingRow } from "@/shared/ui/pending";
import { SectionPanel } from "@/shared/ui/section-panel";
import { SECTION_HEADING_TEXT } from "@/shared/ui/section-heading";
import type { AgentTemplate } from "../client/types";
import type { TemplateSectionDef } from "../lib/visibility";

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
 * anywhere under `features/agent-templates/` is a regression with a test behind
 * it (`template-editor-surface.test.tsx › no concave surfaces`) — and since 2026-08-26
 * that sweep also reaches `apps/desktop-ui/src/pages/home/agent-*.tsx`, because
 * the /home Agents face reuses THIS module rather than growing a second panel
 * recipe (Q4, `home-agents-tab.plan.md` §0.6).
 *
 * ⚠ AN EMPTY SECTION KEEPS ITS HEADER and says one quiet line. A panel that
 * vanished when empty would make "you have no team templates" and "this
 * workspace has no teams" the same picture, and the create affordance sits at
 * page level precisely so no section has to grow one.
 *
 * ⚠ THREE PARTS, BECAUSE TWO SURFACES COMPOSE THEM DIFFERENTLY. The workspace
 * page stacks whole {@link TemplateSection}s; the /home pane needs the same
 * PANEL with a scope pill in its header and a body that can also say "in
 * flight" or "unavailable" — so the shell ({@link TemplatePanel}) and the grid
 * ({@link TemplateGrid}) are separately callable. **Neither surface forks the
 * class strings**, which is the whole point of the split.
 */

/**
 * The flat panel shell: heading, optional header control, optional caption.
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
 * THE TEMPLATE CARD'S NAME TYPE — title size, medium weight, primary ink.
 * ⚠ EXPORTED (2026-09-13) because Samuel named THIS text as the reference for
 * the /home Overview's "Usage" heading and its scope menu ("extract that exact
 * font, font size, and font color and apply it"); one constant, two readers.
 */
export const TEMPLATE_NAME_TEXT = "text-title font-medium text-text-primary";

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
 * "not `TEMPLATE_NAME_TEXT_LG`"); delete it together with those references, not
 * before them.
 *
 * ⚠ **IT WAS APPLIED TO FOUR THINGS FOR ONE PASS AND THREE OF THEM WERE A
 * MISREAD — Samuel, same day, rejecting it: *"You changed the font size of the
 * credit spend, all channels, and the date to the super large size, like usage. I
 * did not ask for that. I only asked you to change the usage size to be
 * bigger."*** The scope menu (**All channels**), the month label and the credit
 * card's **Credit spend** heading are on `TEMPLATE_NAME_TEXT` — the 14px face —
 * and the month label was RAISED to it rather than to this one, which is the
 * whole of what *"the month switcher as well"* asked for. **The block has two
 * scales on purpose: the panel heading, then everything inside it.** Do not
 * widen this constant's readers without a ruling that names one.
 *
 * ⚠ **A STEP ON THE TOKEN SCALE, NEVER A PX** (`docs/DESIGN-SYSTEM.md` › Type
 * scale): `text-title` → `text-display` is the next utility, and there is
 * nothing between them to pick instead.
 *
 * ⚠ **IT SITS BESIDE `TEMPLATE_NAME_TEXT` RATHER THAN OVERRIDING IT AT THE CALL
 * SITE.** The agent template card keeps the smaller face — a card NAME in a list
 * is not a page heading — and a `cn(TEMPLATE_NAME_TEXT, "text-display
 * font-semibold")` at the reader would be a same-layer fight with the constant it
 * is composing, which is how a heading silently keeps 14px.
 */
export const TEMPLATE_NAME_TEXT_LG = SECTION_HEADING_TEXT;

/**
 * THE CARD GRID — FOUR to a row, FIXED (Samuel, 2026-09-13: *"I want to
 * increase width of cards so it's 4 per row"*, then over an auto-fill that gave
 * two: *"this is 2 on a row. I said 4 on a row"*). Not `auto-fill`: the count is
 * the ruling, the width follows. Exported so both Agents skeletons byte-share it.
 */
export const TEMPLATE_GRID = "grid grid-cols-4 gap-2.5";

export function TemplatePanel({
  id,
  label,
  action,
  caption,
  children,
}: {
  /** Id the heading carries, so the section is a NAMED region. */
  id: string;
  label: string;
  /** Header-right control (the /home face's scope pill). */
  action?: ReactNode;
  /** ONE quiet line under the heading. ⚠ Minimal-copy ruling (INVARIANTS §5):
   *  a RULE the operator needs, never an explainer paragraph. */
  caption?: string;
  children: ReactNode;
}) {
  return (
    <SectionPanel
      id={id}
      label={label}
      action={action}
      caption={caption}
      // ⚠ NO `className`, AND THAT IS THE POINT SINCE R-38 (2026-09-17). The
      // ground was typed here, then hoisted to `SECTION_PANEL_GROUND` when the
      // knowledge base-info face wanted the same one; it is the COMPONENT's
      // default now, so the last two readers of the constant are the ghosts.
    >
      {children}
    </SectionPanel>
  );
}

/** The card grid, or the one quiet line that stands in for it. */
export function TemplateGrid({
  templates,
  emptyLine,
  onOpen,
  pendingIds,
  markerFor,
  actionFor,
}: {
  templates: ReadonlyArray<AgentTemplate>;
  /** ⚠ Only ever rendered against a RESOLVED read — see `resolved` on
   *  `../hooks/use-agent-templates.ts`. */
  emptyLine: string;
  /** Absent = the cards are not openable on this surface yet (see
   *  {@link TemplateCard}). */
  onOpen?: (template: AgentTemplate) => void;
  /** Rows with a write in flight — dimmed and inert via the kit's PENDING_ROW. */
  pendingIds?: ReadonlySet<string>;
  /** `by <member>` for a row this operator did not write, else `null`. */
  markerFor?: (template: AgentTemplate) => string | null;
  /** A SECOND control for a row, under the body ({@link TemplateCard}). */
  actionFor?: (template: AgentTemplate) => ReactNode;
}) {
  if (templates.length === 0) {
    return <p className="px-1 pb-1 text-caption text-text-muted">{emptyLine}</p>;
  }
  return (
    <div className={TEMPLATE_GRID}>
      {templates.map((template) => (
        <TemplateCard
          key={template.id}
          template={template}
          onOpen={onOpen}
          pending={pendingIds?.has(template.id) ?? false}
          marker={markerFor?.(template) ?? null}
          action={actionFor?.(template) ?? null}
        />
      ))}
    </div>
  );
}

export function TemplateSection({
  section,
  templates,
  onOpen,
  pendingIds,
}: {
  section: TemplateSectionDef;
  templates: ReadonlyArray<AgentTemplate>;
  onOpen: (template: AgentTemplate) => void;
  pendingIds?: ReadonlySet<string>;
}) {
  return (
    <TemplatePanel
      id={`agent-templates-${section.visibility}`}
      label={section.label}
    >
      <TemplateGrid
        templates={templates}
        emptyLine={section.emptyLine}
        onOpen={onOpen}
        pendingIds={pendingIds}
      />
    </TemplatePanel>
  );
}

/**
 * One template, as a card.
 *
 * ⚠ MINIMAL BY RULING (INVARIANTS §5): the NAME, a muted description line, and a
 * model chip only WHEN one is set. `agentModelShortLabel` returns `null` for an
 * unset model and that is not the same answer as "Default" — a card states what
 * a template CARRIES, and a chip reading "Default" on every unset row would be
 * three words of chrome per card saying nothing.
 *
 * ⚠ THE WHOLE CARD IS THE AFFORDANCE — WHEN THERE IS ONE. `onOpen` absent
 * renders a plain `div`, not a dead `button`: a card that looks pressable and
 * does nothing is worse than one that does not invite the press. Both surfaces
 * pass one now (the /home face gained its editor in `home-agents-tab.plan.md`
 * M3), so the branch is kept for the next surface that lists templates it
 * cannot author. ⚠ **A row may carry ONE second control (`action`), and it goes
 * INSIDE the face rather than on top of it** — a `<button>` may not contain a
 * `<button>`, so an action turns the card into a `div` whose body is the button.
 * The /home face's scope-C rows use it for "Use in this channel" (the COPY, §3).
 * There is no kebab, no per-card delete, and **no launch control** —
 * launch-time SELECTION belongs to the Chat face's picker and must not grow a
 * beachhead here (§5A: a second launch surface fights `resolve`'s singularity).
 *
 * ⚠ THE AUTHORSHIP MARKER IS A SECURITY SIGNAL, NOT DECORATION
 * (`template-picker.tsx › authorMarker`). A template another member wrote
 * carries instructions the operator's agent will follow; the desktop wears a
 * different ROLE header for one (§5A), and the operator must be able to see the
 * same fact BEFORE it runs. It renders first, above the name.
 */
function TemplateCard({
  template,
  onOpen,
  pending,
  marker,
  action,
}: {
  template: AgentTemplate;
  onOpen?: (template: AgentTemplate) => void;
  pending: boolean;
  marker: string | null;
  action: ReactNode;
}) {
  const model = agentModelShortLabel(template.model);
  const description = template.description?.trim();
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
        <span className={cn("min-w-0 truncate", TEMPLATE_NAME_TEXT)}>
          {template.name}
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
  const raise =
    "transition-shadow hover:shadow-[0_2px_4px_rgba(0,0,0,0.06),0_10px_24px_rgba(0,0,0,0.07)]";

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
            onClick={() => onOpen(template)}
            className="flex flex-1 cursor-pointer flex-col items-start gap-1.5 text-left"
          >
            {body}
          </button>
        ) : (
          body
        )}
        <div className="pt-0.5">{action}</div>
      </div>
    );
  }

  if (!onOpen) return <div {...pendingRow(pending, face)}>{body}</div>;
  return (
    <button
      type="button"
      onClick={() => onOpen(template)}
      {...pendingRow(pending, cn(face, "cursor-pointer", raise))}
    >
      {body}
    </button>
  );
}

"use client";

import type { ReactNode } from "react";
import { cn } from "@/shared/lib/utils";
import { agentModelShortLabel } from "@/features/channels/lib/agent-models";
import { pendingRow } from "@/shared/ui/pending";
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
 * it (`template-editor.test.tsx › no concave surfaces`) — and since 2026-08-26
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

/** The flat panel shell: heading, optional header control, optional caption. */
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
    <section
      aria-labelledby={id}
      className="rounded-[14px] border border-border-subtle bg-card-surface-subtle p-3"
    >
      <div className="flex min-h-[22px] items-center justify-between gap-2 px-1 pb-2.5">
        <h2
          id={id}
          className="truncate text-label font-semibold uppercase tracking-wide text-text-secondary"
        >
          {label}
        </h2>
        {action}
      </div>
      {caption && (
        <p className="px-1 pb-2.5 text-caption text-text-muted">{caption}</p>
      )}
      {children}
    </section>
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
    <div className="grid grid-cols-[repeat(auto-fill,minmax(196px,1fr))] gap-2.5">
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
      <span className="truncate text-title font-medium text-text-primary">
        {template.name}
      </span>
      {description && (
        <span className="line-clamp-2 text-caption leading-relaxed text-text-secondary">
          {description}
        </span>
      )}
      {model && (
        <span className="mt-auto w-fit rounded-full border border-border-strong bg-bg-inset px-2 py-0.5 text-micro font-medium text-text-secondary">
          {model}
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

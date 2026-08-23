"use client";

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
 * it (`template-editor.test.tsx › no concave surfaces`).
 *
 * ⚠ AN EMPTY SECTION KEEPS ITS HEADER and says one quiet line. A panel that
 * vanished when empty would make "you have no team templates" and "this
 * workspace has no teams" the same picture, and the create affordance sits at
 * page level precisely so no section has to grow one.
 */

export function TemplateSection({
  section,
  templates,
  onOpen,
  pendingIds,
}: {
  section: TemplateSectionDef;
  templates: ReadonlyArray<AgentTemplate>;
  onOpen: (template: AgentTemplate) => void;
  /** Rows with a write in flight — dimmed and inert via the kit's PENDING_ROW. */
  pendingIds?: ReadonlySet<string>;
}) {
  return (
    <section
      aria-labelledby={`agent-templates-${section.visibility}`}
      className="rounded-[14px] border border-border-subtle bg-card-surface-subtle p-3"
    >
      <h2
        id={`agent-templates-${section.visibility}`}
        className="px-1 pb-2.5 text-label font-semibold uppercase tracking-wide text-text-secondary"
      >
        {section.label}
      </h2>

      {templates.length === 0 ? (
        <p className="px-1 pb-1 text-caption text-text-muted">{section.emptyLine}</p>
      ) : (
        <div className="grid grid-cols-[repeat(auto-fill,minmax(196px,1fr))] gap-2.5">
          {templates.map((template) => (
            <TemplateCard
              key={template.id}
              template={template}
              onOpen={onOpen}
              pending={pendingIds?.has(template.id) ?? false}
            />
          ))}
        </div>
      )}
    </section>
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
 * ⚠ THE WHOLE CARD IS THE AFFORDANCE. Clicking it opens the editor; there is no
 * kebab, no per-card delete, and no launch control — launch-time SELECTION is a
 * later phase and must not grow a beachhead here.
 */
function TemplateCard({
  template,
  onOpen,
  pending,
}: {
  template: AgentTemplate;
  onOpen: (template: AgentTemplate) => void;
  pending: boolean;
}) {
  const model = agentModelShortLabel(template.model);
  const description = template.description?.trim();

  return (
    <button
      type="button"
      onClick={() => onOpen(template)}
      {...pendingRow(
        pending,
        cn(
          "bento flex min-h-[92px] cursor-pointer flex-col gap-1.5 p-3 text-left",
          "transition-shadow hover:shadow-[0_2px_4px_rgba(0,0,0,0.06),0_10px_24px_rgba(0,0,0,0.07)]"
        )
      )}
    >
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
    </button>
  );
}

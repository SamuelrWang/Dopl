"use client";

import type { ReactNode } from "react";
import { cn } from "@/shared/lib/utils";

/**
 * THE FLAT SECTION — a labelled region whose header and content sit on ONE
 * ground. `SectionBox`'s opposite number, and the two are a real choice:
 *
 * | | `SectionBox` (`./section-box.tsx`) | `SectionPanel` (this) |
 * | --- | --- | --- |
 * | frame | `border-border-strong`, 14px radius | none — the caller paints |
 * | header | its own `bg-card-surface-subtle` STRIP | a row on the same ground |
 * | body | `bg-bg-inset` + the concave inset shadow | the same ground |
 * | extra | drag-to-resize grip | none |
 *
 * ⚠ **IT PAINTS NOTHING.** No fill, no border, no radius beyond the corner —
 * the GROUND is `className`, and that is the whole scoping story: this component
 * does not choose grounds. /home's record pane repaints its panels `--home-panel`
 * in one CSS rule; a workspace page passes `SECTION_PANEL_GROUND`. A `tone="home"`
 * prop would turn a per-mount decision into an enum one autocomplete away from
 * every page.
 *
 * ⚠ `data-section-panel` IS A PAGE-SCOPING HOOK, NOT DECORATION — how
 * `apps/desktop-ui/src/pages/home/home.module.css` repaints every panel in the
 * record pane in one rule. Swapping a utility class at a call site cannot
 * silently break an override keyed on an attribute.
 *
 * ⚠ AN EMPTY SECTION KEEPS ITS HEADER. A panel that vanished when empty makes
 * "you have none" and "there are none to have" the same picture.
 */
/**
 * THE DEFAULT GROUND for a `SectionPanel` on a WORKSPACE page — a gray WELL, the
 * frame model's last step (Samuel, 2026-08-30: *"panels on top of that go back
 * to that sidebar panel gray — it's alternating"*). A workspace page renders
 * inside `app-shell.module.css › .pageCard`, the white card floating in the one
 * gray panel, so a panel drawn ON that page is exactly where /home's record-pane
 * wells are — and it takes the same token they do.
 *
 * ⚠ IT IS `--home-panel` AND NOT `bg-card-surface-subtle` (#f4f6f9) BECAUSE THE
 * WELL IS ONE COLOUR IN BOTH HOSTS: the two grays were 3/255 apart and said the
 * same thing twice. ⚠ The hairline STAYS here and /home's rule clears it — that
 * page's record pane is already a bounded card, a workspace page's is not.
 *
 * ⚠ IT IS A DEFAULT, NOT THE COMPONENT'S OWN FACE — a page selects its ground by
 * passing something else, and /home passes nothing at all. It exists because the
 * value was stated inline in two features (`agent-templates/components/
 * template-section.tsx › TemplatePanel` and the knowledge base-info face).
 */
export const SECTION_PANEL_GROUND =
  "border border-border-subtle bg-home-panel";

export function SectionPanel({
  id,
  label,
  action,
  caption,
  className,
  titleClassName,
  children,
}: {
  /** Id the heading carries, so the section is a NAMED region. */
  id: string;
  label: string;
  /** Header-right control. */
  action?: ReactNode;
  /** ONE quiet line under the heading. ⚠ Minimal-copy ruling (INVARIANTS §5):
   *  a RULE the operator needs, never an explainer paragraph. */
  caption?: ReactNode;
  /** THE GROUND — fill, border and padding. See the docblock. */
  className?: string;
  /** Overrides the heading's size/case/ink for ONE panel (the /home Usage
   *  trial, 2026-09-08). Layout stays the panel's. */
  titleClassName?: string;
  children: ReactNode;
}) {
  return (
    <section
      aria-labelledby={id}
      data-section-panel
      className={cn("rounded-[14px] p-3", className)}
    >
      <div className="flex min-h-[22px] items-center justify-between gap-2 px-1 pb-2.5">
        <h2
          id={id}
          className={cn(
            "truncate text-label font-semibold uppercase tracking-wide text-text-secondary",
            titleClassName
          )}
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

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
 * the GROUND is `className`, and that is the whole scoping story: a page's own
 * palette (`bg-home-panel` and the other `home-*` tokens are /home-ONLY,
 * `docs/DESIGN-SYSTEM.md`) can be selected by a page file without this module
 * ever naming it. A `tone="home"` prop here would put the /home palette one
 * autocomplete away from every workspace page.
 *
 * ⚠ `data-section-panel` IS A PAGE-SCOPING HOOK, NOT DECORATION. It is how
 * `apps/desktop-ui/src/pages/home/home.module.css` repaints every panel inside
 * the record pane in one rule, instead of each mount restating the ground — the
 * same attribute idiom `composer-request-panel.tsx › PANEL_HOOK` uses, and for
 * the same reason: swapping a utility class at a call site cannot silently
 * break an override keyed on an attribute.
 *
 * ⚠ AN EMPTY SECTION KEEPS ITS HEADER. A panel that vanished when empty makes
 * "you have none" and "there are none to have" the same picture.
 */
/**
 * THE DEFAULT GROUND for a `SectionPanel` on a WORKSPACE page — the kit's flat
 * "header strips, inset cards" token on a hairline.
 *
 * ⚠ IT IS A DEFAULT, NOT THE COMPONENT'S OWN FACE. `SectionPanel` still paints
 * nothing (see the docblock): a page palette selects itself by passing
 * something else, and /home passes nothing at all because its record pane
 * repaints every panel inside it in one rule. This constant exists because the
 * value was stated inline in two features — `agent-templates/components/
 * template-section.tsx › TemplatePanel` and the knowledge base-info face — and
 * two identical class strings in two trees is one restyle away from a fork.
 */
export const SECTION_PANEL_GROUND =
  "border border-border-subtle bg-card-surface-subtle";

export function SectionPanel({
  id,
  label,
  action,
  caption,
  className,
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

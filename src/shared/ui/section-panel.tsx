"use client";

import type { ReactNode } from "react";
import { cn } from "@/shared/lib/utils";
import { SECTION_HEADING_TEXT } from "./section-heading";

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
 * ⚠ **IT PAINTS ONE GROUND, AND THAT IS NEW ON 2026-09-17 (R-38 + R-39).** It
 * used to paint nothing and be grounded per host — a `:global()` rule on /home,
 * `SECTION_PANEL_GROUND` on a workspace page. Samuel ruled the two surfaces
 * match and the section language FLAT, so there is one ground left to choose and
 * the component is where it is said. A caller that needs another passes it (`cn`
 * wins on `className`); there is no `tone` enum.
 *
 * ⚠ `data-section-panel` STAYS, now a hook with no rule on it in either kit
 * copy — it is the difference between "a page can repaint every panel at once"
 * and a sweep of call sites.
 *
 * ⚠ AN EMPTY SECTION KEEPS ITS HEADER. A panel that vanished when empty makes
 * "you have none" and "there are none to have" the same picture.
 */
/**
 * THE GROUND — a gray WELL, the frame model's last step (Samuel, 2026-08-30:
 * *"panels on top of that go back to that sidebar panel gray — it's
 * alternating"*). A workspace page renders inside `app-shell.module.css ›
 * .pageCard`, the white card floating in the one gray panel, so a panel drawn ON
 * that page is exactly where /home's record-pane wells are — same token.
 *
 * ⚠ IT IS `--home-panel` AND NOT `bg-card-surface-subtle` (#f4f6f9): the two
 * grays were 3/255 apart and said the same thing twice.
 *
 * 🔒 ⚠ **NO HAIRLINE (Samuel's ruling R-39, 2026-09-17: flat wins)** — *"you're
 * adding this extra border line around the gray. I did not ask for that"*
 * (2026-09-13). ⚠ `border-transparent`, NOT `border: none`: the background
 * paints under the border box, so a transparent hairline is seamless AND leaves
 * the box model alone; dropping the border moves every panel's content a pixel.
 *
 * ⚠ EXPORTED BECAUSE THE GHOSTS ARE NOT `SectionPanel` — a loading shape draws a
 * plain `div` (it must not paint a heading STRING), so it reads the ground by
 * name rather than by mounting the component.
 */
export const SECTION_PANEL_GROUND =
  "border border-transparent bg-home-panel";

/**
 * THE WELL'S GEOMETRY — radius + padding, the half `SectionPanel` paints for
 * every caller regardless of the ground it is handed.
 *
 * ⚠ **EXPORTED SO THE WELL IS ONE RECIPE AND NOT A MEASUREMENT** (2026-09-13,
 * the object panel's field sections). `ontology/components/panel-section.tsx ›
 * PANEL_WELL` is the Token-spend well — `bg-home-panel` on this geometry, no
 * hairline (the same face `SECTION_PANEL_GROUND` has carried on every page since
 * R-39 flattened it) — reached by IMPORT rather than by retyping `rounded-[14px] p-3`, so the day
 * the well's radius or padding moves it moves on both surfaces at once.
 */
export const SECTION_PANEL_SHELL = "rounded-[14px] p-3";

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
  /** OVERRIDES the ground. See the docblock — the default is painted. */
  className?: string;
  children: ReactNode;
}) {
  return (
    <section
      aria-labelledby={id}
      data-section-panel
      className={cn(SECTION_PANEL_SHELL, SECTION_PANEL_GROUND, className)}
    >
      <div className="flex min-h-[22px] items-center justify-between gap-2 px-1 pb-2.5">
        {/* ⚠ ONE HEADING FACE, EVERY PAGE — `section-heading.ts ›
            SECTION_HEADING_TEXT` (Samuel, 2026-09-13: the /home "Usage" trial
            is the rule now, "applied to each of the headers for each section").
            No per-panel override: the slot that existed for the trial is gone
            with the trial's promotion. */}
        <h2
          id={id}
          className={cn("truncate", SECTION_HEADING_TEXT)}
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

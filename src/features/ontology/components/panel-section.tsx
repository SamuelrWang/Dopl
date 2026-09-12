"use client";

import type { ReactNode } from "react";

/**
 * THE OBJECT PANEL'S SECTION — **A LABEL ROW AND ITS ROWS, FLUSH LEFT. NO
 * FRAME, NO INSET, NO GRIP** (Samuel, 2026-09-12, looking at the panel:
 * *"Firstly, no more indented stuff"*).
 *
 * ⚠ **IT REPLACES `shared/ui/section-box.tsx › SectionBox` IN THIS PANEL ONLY.**
 * That component is the app's bordered section — a rounded `--border-strong`
 * frame over a CONCAVE inset body with a drag grip — and inside a 420px pane it
 * nested three of those frames, each with its own inset well and its own inset
 * add-row, one indent deeper than the panel's own padding. Fifteen other callers
 * still want that face, so nothing about `SectionBox` changed; what changed is
 * that this panel does not wear it.
 *
 * ⚠ **THE LABEL ROW IS `SectionBox`'s OWN TYPE, DELIBERATELY** — `text-label`
 * semi-bold uppercase, the count beside it muted — so the panel's sections and
 * every bordered section elsewhere still read as the same KIND of thing. The
 * frame was the indent; the label was never the problem.
 *
 * ⚠ **THE LABEL IS AN `h3`**, so each section is a landmark a reader can reach
 * by role — which is also what the History pin
 * (`pages/home/ontology-panels.test.tsx`) matches on.
 */
export function PanelSection({
  label,
  meta,
  children,
}: {
  label: string;
  /** The count, rendered muted beside the label. */
  meta?: string;
  children: ReactNode;
}) {
  return (
    <section className="flex min-w-0 flex-col gap-2">
      <div className="flex items-center gap-2">
        <h3 className="text-label font-semibold uppercase tracking-wide text-text-secondary">
          {label}
        </h3>
        {meta && <span className="text-caption text-text-muted">{meta}</span>}
      </div>
      {children}
    </section>
  );
}

/**
 * THE ROW'S REMOVE ✕ — naked, revealed on the row's hover. ⚠ ONE DECLARATION
 * FOR THE FOUR EDITORS: the identical string was written out in each of them,
 * so a change to the reveal or the hover ink reached one row shape in four.
 * Pair it with `group` on the row itself.
 */
export const ROW_REMOVE_BUTTON =
  "rounded-md p-1 text-text-muted opacity-0 transition " +
  "hover:bg-surface-raised-3 hover:text-text-primary group-hover:opacity-100";

/**
 * THE ADD ROW — the section's last row, flush with its own rows. ⚠ It was a
 * bordered footer strip over a `--card-surface-subtle` fill INSIDE the section
 * frame; with the frame gone the strip would be a box drawn around the only row
 * that has no data in it.
 */
export const PANEL_ADD_ROW = "flex flex-wrap items-center gap-2";

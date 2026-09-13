"use client";

import { useState, type ReactNode } from "react";
import { Plus } from "lucide-react";
import { cn } from "@/shared/lib/utils";
import {
  SECTION_PANEL_SHELL,
} from "@/shared/ui/section-panel";
import { SMALL_TEXT_BUTTON } from "@/shared/ui/small-action-button";

/**
 * THE OBJECT PANEL'S SECTION — **AN UPPERCASE LABEL, FLAT AND FLUSH LEFT, OVER A
 * GRAY WELL OF WHITE ROW BARS** (Samuel, 2026-09-12: *"Firstly, no more indented
 * stuff"*; 2026-09-13, over the same panel: *"each of those items should have the
 * gray background where it sits, kind of like the overview you see. For example,
 * token spend: you can see that it's sitting on a gray box and on top of it are
 * white panels. Each field should be a white bar"*).
 *
 * ⚠ **THE FRAME DID NOT COME BACK.** What 2026-09-12 deleted was a BOX DRAWN
 * AROUND THE LABEL — `shared/ui/section-box.tsx › SectionBox`'s rounded frame, its
 * own header strip, a concave inset body and a drag grip, three of them nested
 * inside a 420px pane. The label still sits on the panel's own ground with
 * nothing around it; what is new is beneath it, and it is the frame model's
 * ALTERNATION (docs/DESIGN-SYSTEM.md § the three grounds), not a frame: level 3
 * WELL, level 2 CARD.
 *
 * ⚠ **THE COUNT IS GONE** (Samuel, 2026-09-13: *"Remove the count, the number of
 * items in each. Right now next to word attributes I see the number 0"*). The
 * `meta` prop is DELETED rather than left unpassed — an optional slot beside the
 * label is how the number comes back in a later edit — and the rows are the
 * count now.
 *
 * ⚠ **THE LABEL IS AN `h3`**, so each section is a landmark a reader can reach
 * by role — which is also what the History pin
 * (`pages/home/ontology-panels.test.tsx`) matches on.
 */
export function PanelSection({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    // 🔒 **THE SECTION *IS* THE WELL, AND THE LABEL SITS INSIDE IT** — exactly
    // the /home Overview's Token-spend panel (Samuel, 2026-09-13, second time:
    // *"the word 'token spend' is sitting on the gray box … the words
    // 'attributes', 'relationships', and 'actions' are not even in the gray"*).
    // Same header row geometry as `shared/ui/section-panel.tsx › SectionPanel`.
    <section className={PANEL_WELL}>
      <div className="flex min-h-[22px] items-center px-1 pb-0.5">
        <h3 className="truncate text-label font-semibold uppercase tracking-wide text-text-secondary">
          {label}
        </h3>
      </div>
      {children}
    </section>
  );
}

/**
 * THE SECTION'S WELL — the gray box the label AND the rows sit in, **THE /home
 * OVERVIEW'S TOKEN-SPEND WELL REACHED BY IMPORT** (Samuel named that panel as
 * the reference). `SECTION_PANEL_SHELL` is the radius + padding; the fill is
 * `--home-panel` exactly as `/home`'s record pane paints every `SectionPanel`
 * (`pages/home/home.module.css › .frame [data-section-panel]`: `--home-panel`,
 * border transparent).
 *
 * ⚠ **NO HAIRLINE.** `SECTION_PANEL_GROUND` is the WORKSPACE-page ground and
 * carries `border-border-subtle`; the Overview Samuel pointed at has none
 * (2026-09-13: *"you're adding this extra border line around the gray. I did
 * not ask for that"*). Do not compose it here.
 *
 * ⚠ **DO NOT RE-TYPE THE RADIUS/PADDING.** A local `rounded-[14px] p-3` is the
 * same well said a second way.
 */
export const PANEL_WELL = cn(
  SECTION_PANEL_SHELL,
  "bg-home-panel flex min-w-0 flex-col gap-2"
);

/** THE ROWS' COLUMN inside the well — direction and gap only, no surface. */
export const PANEL_ROWS = "flex min-w-0 flex-col gap-2";

/**
 * ONE ROW = **ONE WHITE BAR ON THAT WELL** — `.bento`, the kit's inner card, the
 * same class the Token-spend panel's white face wears (level 2 of the frame
 * model). Fill, hairline, radius and the soft double shadow are the CLASS's; the
 * caller composes direction and gaps, which is how `.bento` is documented to be
 * used, so an attribute's one-line row and an action's four-field stack are the
 * same bar.
 *
 * ⚠ **THE FIELDS SIT ON THE BAR, NOT IN WELLS OF THEIR OWN.** Every input inside
 * is still the popup kit's underline (`board-header-bits.tsx ›
 * InlineUnderlineField`) and every picker a `SelectMenu` text face — the
 * 2026-09-12 ruling — so the bar adds a surface, never an indent.
 */
export const PANEL_ROW = "bento min-w-0 px-2.5 py-2";

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
 * **+ ADD — UNDER THE ROWS, INSIDE THE WELL, AND IT APPENDS AN EMPTY ROW**
 * (Samuel, 2026-09-13: *"The 'Add' button should be under it, right? The 'Add'
 * button creates new pairings of those two"*).
 *
 * ⚠ **IT IS NOT AN ADD *FORM* ANY MORE, AND THAT IS THE WHOLE RULING.** Each
 * section used to end with a composer — a name field, a kind picker and this
 * button — so the value cell for a new field did not exist until the name had
 * been typed and submitted (Samuel: *"I have to put text into 'new attribute',
 * and when I click 'Add', the field for value comes up. I don't like this"*). The
 * new row shows every cell at once, from the moment it appears.
 *
 * ⚠ ONE ACCESSIBLE NAME, "Add", in all four sections — the button says what it
 * does and the section it is in says what of.
 */
export function PanelAddButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(SMALL_TEXT_BUTTON, "gap-1 self-start")}
    >
      <Plus size={11} /> Add
    </button>
  );
}

/**
 * THE ROWS THAT ARE NOT SAVED YET.
 *
 * ⚠ **AN UNNAMED ROW IS NOT WRITTEN, AND THIS IS WHERE IT WAITS.** A blank
 * attribute / field / edge / action has no address: an attribute's `key` is its
 * label slugged, a relationship is addressed BY LABEL in the reducer
 * (`graph-state.ts › RELATIONSHIP_SET`, which also drops any edge with no
 * targets), and the object PATCH the store debounces would carry `key: ""`. So
 * `+ Add` appends here, the row edits locally, and it is dispatched through the
 * SAME existing action the old composer used the moment it has a name (an edge:
 * the moment it has a TARGET). Nothing new reaches the server.
 *
 * ⚠ **KEY THE RENDERED ROWS BY POSITION — `row-${i}` over the persisted rows and
 * `row-${persisted.length + n}` over these — AND THE COMMIT KEEPS ITS FOCUS.** A
 * committed draft lands at exactly the index it was already drawn at, so React
 * reconciles the same subtree instead of unmounting the row under the caret. Keys
 * off the data (a label, a uuid) put the caret on the floor mid-word.
 */
export function useDraftRows<T>(blank: () => T) {
  const [drafts, setDrafts] = useState<T[]>([]);
  return {
    drafts,
    add: () => setDrafts((rows) => [...rows, blank()]),
    patch: (index: number, next: T) =>
      setDrafts((rows) => rows.map((row, i) => (i === index ? next : row))),
    drop: (index: number) =>
      setDrafts((rows) => rows.filter((_, i) => i !== index)),
  };
}

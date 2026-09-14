"use client";

/**
 * THE COMPOSER PANELS' SHARED FIELD KIT — one label/value row, drawn one way.
 *
 * ⚠ **THE FILE WAS `composer-request-panel.tsx` AND HELD `AgentRequestPanel` UNTIL 2026-09-08**,
 * when the inline new-thread form became a popup (`new-thread-dialog.tsx › NewThreadDialog`) and
 * that panel was DELETED. The KIT survived: `composer-launch-panel.tsx` mounts it and
 * `panel-field.test.tsx` pins it.
 *
 * ⚠ THE SEAM IS §1's "one file, one reason to change". This is FIELD SHAPE — a raised card, a
 * label, an underline that is a real element — and it moves when a field's anatomy moves, never
 * when a form's contents do.
 *
 * ⚠ `data-composer-panel` IS A STYLING HOOK, NOT STATE. /home repaints a panel body with the
 * account palette (`pages/home/home.module.css`, the same fence `[data-attribution-pill]` uses);
 * the workspace channels page keeps the neutral fill. Attribute rather than a class name so the
 * override cannot be broken by a utility being swapped here.
 */

import { type ReactNode } from "react";
import { RAISED_WELL } from "@/shared/ui/wells";
import { cn } from "@/shared/lib/utils";

/**
 * The raised card a field sits on — PADDING AND ELEVATION ONLY.
 *
 * ⚠ THE UNDERLINE IS NOT ON THIS ELEMENT (2026-08-27 correction). As `border-b-*` on the card,
 * composed over `RAISED_WELL`'s own border, it rendered NOTHING VISIBLE — swallowed by the radius
 * and the elevation — and jsdom cannot show that, so the class-name assertion that "pinned" it
 * passed over a line nobody could see. It is its own NODE now ({@link FIELD_LINE}), inside the
 * padded content box where no parent radius or overflow can reach it.
 */
export const FIELD_CARD = "flex px-3 py-2.5";

/**
 * THE UNDERLINE, AS A REAL ELEMENT — the row that holds the label and the value, with the line
 * on its own bottom edge.
 *
 * ⚠ IT SPANS LABEL **AND** VALUE, so the line runs the full width of the card's content box and
 * `Name:` sits on it rather than over nothing.
 * ⚠ `focus-within`, not `focus:` — the focus lands on the `<input>` one level down.
 * ⚠ `pb-1` IS THE GAP BETWEEN TEXT AND LINE and belongs here, not to the card, whose `py-2.5` is
 * the breathing room OUTSIDE the line.
 * ⚠ TAGGED `data-field-line` SO A TEST CAN ASSERT THE NODE EXISTS, not merely that a class string
 * appears — the failure this replaces was a class that was present and invisible.
 */
export const FIELD_ROW = "flex w-full min-w-0 items-start gap-2";

/** The line itself — composed onto {@link FIELD_ROW} for a TEXT field only. */
export const FIELD_LINE =
  "border-b border-border-strong pb-1 transition-colors focus-within:border-text-primary";

/**
 * The value control inside a {@link PanelField} — `UNDERLINE_FIELD` with the underline taken OFF.
 *
 * ⚠ THE LINE BELONGS TO {@link FIELD_LINE}, one level up, so the two cannot draw two lines.
 * `wells.ts › UNDERLINE_FIELD` is UNCHANGED and still carries its own border for its other callers
 * (`info-card-rows.tsx`, `agent-rename.tsx`), where there is no card under the field.
 */
export const FIELD_INPUT =
  "min-w-0 border-0 bg-transparent p-0 text-body text-text-primary outline-none " +
  "placeholder:text-text-disabled";

/**
 * ONE FIELD ROW, so the two panels cannot draw it two ways.
 *
 * ⚠ A COMPONENT RATHER THAN A CLASS PAIR (2026-08-27). The card/line/label nesting is now
 * STRUCTURE, and structure restated at six call sites is how five of them stay right and one
 * drifts. `as="label"` for a text field (the word becomes the field's hit area); `as="div"` for a
 * row whose control is a button, where a wrapping `<label>` would make the word toggle the menu.
 */
export function PanelField({
  label,
  as = "label",
  center = false,
  line = true,
  children,
}: {
  label: string;
  as?: "label" | "div";
  /** Centre the control against the label — the select rows, whose trigger is one line tall. */
  center?: boolean;
  /**
   * Draw the underline. ⚠ TRUE FOR TEXT ENTRY, FALSE FOR A DROPDOWN (Samuel, 2026-08-27).
   * The line is the app's EDIT affordance — it says "type here" — and a select already states
   * that it is a control by being one. Ruling a line under a menu trigger reads as a text field
   * that will not accept text.
   */
  line?: boolean;
  children: ReactNode;
}) {
  const Card = as;
  return (
    <Card className={cn(RAISED_WELL, FIELD_CARD)}>
      {/* ⚠ `data-field-line` IS SET ONLY WHERE THE LINE IS, so its presence and its ABSENCE are
          both assertable — a dropdown row that grew one would fail as loudly as a text field
          that lost one. The row element itself stays either way; it is the flex container. */}
      <span
        {...(line ? { "data-field-line": "" } : {})}
        className={cn(FIELD_ROW, line && FIELD_LINE, center && "items-center")}
      >
        <span className={FIELD_LABEL}>{label}</span>
        {children}
      </span>
    </Card>
  );
}

export const PANEL_BODY =
  "flex min-h-0 flex-col gap-2 overflow-y-auto max-h-[264px]";

/**
 * The label word. ⚠ AUTO-WIDTH — no column (Samuel, 2026-08-27, from the rendered app).
 *
 * It was `w-[84px]`, which put a wide dead gap after every SHORT label and could not deliver the
 * alignment it cost: the two panels carry different label sets, so a column that lines one up is
 * arbitrary in the other. **The value now starts right after the word**, one `gap-2` along.
 */
export const FIELD_LABEL = "shrink-0 pt-px text-body text-text-secondary";

/** The /home repaint hook, as props. ⚠ ONE DECLARATION for both panels — see the header. */
export const PANEL_HOOK = { "data-composer-panel": "" } as const;

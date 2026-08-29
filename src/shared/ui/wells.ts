/** Field-well class recipes. `ontology-bits` re-exports these. */

/** Concave input well — the global .concave-field recipe for add-row fields. */
export const FIELD_WELL = "concave-field rounded-lg focus:outline-none";

/** Raised chip sitting on an inset body — verse-pill on a concave field. */
export const CHIP =
  "rounded-full border border-border-strong bg-bg-elevated px-2.5 py-0.5 text-small font-medium text-text-primary shadow-[0_1px_2px_rgba(0,0,0,0.05)]";

/** Raised block field on an inset body — CHIP's rectangular counterpart, for
 *  inputs/textareas/code wells inside a SectionBox body. */
export const RAISED_WELL =
  "rounded-lg border border-border-default bg-bg-elevated shadow-[0_1px_2px_rgba(0,0,0,0.04)]";

/**
 * THE "PILLOW" TEXT CONTROL — `RAISED_WELL` wearing type, placeholder ink and a
 * focus hairline. Samuel's reference face for EVERY text input in a standard
 * dialog (2026-08-27): the agent-template editor established it, and the four
 * /home dialogs were standardised onto it rather than each restating a
 * `bg-surface-raised-3 border-border-strong` recipe of its own.
 *
 * ⚠ SIZE AND PADDING BELONG TO THE CALLER (`h-9 px-3` for a line, `px-3 py-2`
 * for a block) — this is the FACE, and forking it to bake in one height is how
 * a second input recipe starts. **Promoted here from
 * `features/agent-templates/components/template-editor-rows.tsx`, which
 * re-exports it** (the same move `ontology-bits` made for the three above).
 */
export const RAISED_INPUT = `${RAISED_WELL} w-full text-body text-text-primary outline-none transition-colors placeholder:text-text-muted focus:border-border-highlight`;

/**
 * THE UNDERLINE FIELD — the ANTI-well: no box, no fill, no ring, nothing but a
 * line under the text. `agent-rename.tsx` established it (a title that must not
 * reflow when it becomes editable) and the Main-info custom rows took it; it
 * lives here because it was stated in two files and is now wanted in a third.
 *
 * ⚠ `p-0` IS PART OF THE RECIPE, not a reset to override. The field takes its
 * height from the ROW it sits in (`h-9`/`h-10 items-center`), so the underline
 * lands the same distance below the text everywhere; a padding utility added
 * beside this one fights it in Tailwind's emit order rather than in class order.
 */
export const UNDERLINE_FIELD =
  "min-w-0 border-0 border-b border-text-primary bg-transparent p-0 text-body text-text-primary outline-none placeholder:text-text-disabled";

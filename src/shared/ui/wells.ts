/** Field-well class recipes. */

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
 * The "pillow" text control: `RAISED_WELL` with type, placeholder ink and a focus hairline — the
 * face of every text input in a standard dialog. Size and padding belong to the caller.
 */
export const RAISED_INPUT = `${RAISED_WELL} w-full text-body text-text-primary outline-none transition-colors placeholder:text-text-muted focus:border-border-highlight`;

/**
 * The underline field: no box, fill or ring, just a line under the text (a title must not reflow
 * when it becomes editable). `p-0` is part of the recipe: the field takes its height from its row,
 * and a padding utility beside it fights it in Tailwind's emit order, not class order.
 */
export const UNDERLINE_FIELD =
  "min-w-0 border-0 border-b border-text-primary bg-transparent p-0 text-body text-text-primary outline-none placeholder:text-text-disabled";

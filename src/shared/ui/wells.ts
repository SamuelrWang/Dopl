/**
 * Field-well class recipes — study-notes design language, verbatim.
 * Promoted from ontology-bits when configuration became the second
 * consumer (same path SectionBox took).
 */

/** Concave input well — the global .concave-field recipe for add-row fields. */
export const FIELD_WELL = "concave-field rounded-lg focus:outline-none";

/** Raised chip sitting on an inset body — verse-pill on a concave field. */
export const CHIP =
  "rounded-full border border-border-strong bg-bg-elevated px-2.5 py-0.5 text-small font-medium text-text-primary shadow-[0_1px_2px_rgba(0,0,0,0.05)]";

/**
 * Raised block field sitting on an inset body — the rectangular
 * counterpart of CHIP, for inputs/textareas/code wells inside a
 * SectionBox body.
 */
export const RAISED_WELL =
  "rounded-lg border border-border-default bg-bg-elevated shadow-[0_1px_2px_rgba(0,0,0,0.04)]";

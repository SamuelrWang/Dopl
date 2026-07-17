/** Shared atoms — study-notes design language (copied from ontology-bits;
 *  §3 forbids cross-feature component imports). */

/** Concave input well — the global .concave-field recipe for add-row fields. */
export const FIELD_WELL = "concave-field rounded-lg focus:outline-none";

/** Raised chip sitting on an inset body. */
export const CHIP =
  "rounded-full border border-border-strong bg-bg-elevated px-2.5 py-0.5 text-small font-medium text-text-primary shadow-[0_1px_2px_rgba(0,0,0,0.05)]";

/** Flat chip sitting on a raised card (reads/actions on a step card). */
export const FLAT_CHIP =
  "inline-flex max-w-full items-center gap-1 rounded-full border border-border-default bg-bg-inset px-2 py-px text-micro font-medium text-text-secondary";

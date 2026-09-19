/**
 * **KNOWLEDGE CAPS THE SERVER AND THE AGENT SURFACE BOTH HAVE TO AGREE ON** —
 * one declaration, imported, never quoted (the rule
 * `src/shared/channels/caps.ts` states in full).
 *
 * ⚠ **EVERY NUMBER HERE IS A CONTEXT BUDGET, NOT A STORAGE ONE.** Storage is
 * bounded elsewhere (`service-storage.ts`, 1 MB a body and a per-base plan
 * limit) and is not what these protect. What these protect is the characters a
 * MODEL pays for — once per read for the nudge — and a model's context is the
 * resource this whole wave exists to spend less of.
 */

/**
 * **THE LENGTH AT WHICH AN UNSECTIONED ENTRY STOPS BEING READABLE IN PARTS.**
 *
 * ⚠ **IT NUDGES, IT NEVER REFUSES** (Samuel's ruling 2026-09-03). A write over
 * this length with no headings LANDS, and the result leads with
 * `reason=UNSECTIONED`. The alternative — refusing — would make an agent that
 * cannot guess our heading taste unable to save its work at all, and the entry
 * it was refusing to write is the entry the user wanted.
 *
 * ⚠ **1,500 IS WHERE THE SAVING STARTS TO MATTER.** Below it the whole entry
 * costs about what an outline plus one section costs, so the headings buy
 * nothing; above it a section read is a fraction of the document, and the ratio
 * only improves. Measured against real entries at the 2026-09-03 wave: a
 * 2,559-char entry reads whole at 2,760 rendered characters and reads one
 * section at 839, with a 319-char outline in between.
 */
export const KB_SECTION_NUDGE_CHARS = 1_500;



/**
 * **KNOWLEDGE CAPS THE SERVER AND THE AGENT SURFACE BOTH HAVE TO AGREE ON** —
 * one declaration, imported, never quoted (the rule
 * `src/shared/channels/caps.ts` states in full).
 *
 * ⚠ **EVERY NUMBER HERE IS A CONTEXT BUDGET, NOT A STORAGE ONE.** Storage is
 * bounded elsewhere (`service-storage.ts`, 1 MB a body and a per-base plan
 * limit) and is not what these protect. What these protect is the characters a
 * MODEL pays for — once per read for the nudge, once per SESSION LAUNCH for the
 * pin — and a model's context is the resource this whole wave exists to spend
 * less of.
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
 * 2,612-char entry reads whole at ~2,750 rendered characters and reads one
 * section at ~640.
 */
export const KB_SECTION_NUDGE_CHARS = 1_500;

/**
 * **WHAT A PINNED SET MAY COST BEFORE THE PIN SAYS SO OUT LOUD.**
 *
 * ⚠ **THE COST IS PER LAUNCH, WHICH IS WHY IT IS NOT THE SAME KIND OF NUMBER AS
 * A READ CAP.** Pinned content is prepended to EVERY agent session this
 * workspace starts (`service-startup-context.ts`), competes with the operator's
 * actual instructions for the model's attention, and is paid whether or not the
 * session ever needed it. A read an agent chose to make is its own; a pin is
 * spent on its behalf, so the person doing the pinning is the one who has to be
 * told the number.
 *
 * ⚠ **4,000 IS HALF THE DELIVERY CAP** (`STARTUP_CONTEXT_CHAR_CAP`, 8,000). Past
 * it the curated set is on course to stop fitting, and the warning arrives while
 * there is still something to do about it rather than after the payload has
 * silently started shipping pointers instead of content.
 */
export const KB_PIN_WARN_CHARS = 4_000;

/**
 * **WHERE A PIN IS REFUSED RATHER THAN WARNED ABOUT.**
 *
 * ⚠ **PAST THIS THE PIN IS NOT DOING WHAT IT LOOKS LIKE IT IS DOING.** The
 * launch payload is capped at 8,000 characters and everything past the cap
 * becomes a POINTER, so a pin that pushes the curated set to 12,000 does not add
 * 4,000 characters of context — it adds an address, while making it likelier
 * that something already pinned is the thing demoted. A verb whose effect is the
 * opposite of its name has to refuse, and the refusal names the outline so the
 * caller can pin a smaller thing instead.
 *
 * ⚠ **1.5× THE DELIVERY CAP, NOT 1×.** Curating slightly more than fits is a
 * legitimate thing to do — `StartupContext.omitted` exists for it — and refusing
 * at exactly 8,000 would refuse the ordinary case.
 */
export const KB_PIN_MAX_CHARS = 12_000;

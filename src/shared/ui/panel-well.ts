/**
 * THE GRAY WELL — **the /home Overview's usage well, as ONE recipe with more than
 * one reader.** `SECTION_PANEL_SHELL`'s radius + padding, filled `--home-panel`,
 * and the label sits INSIDE it.
 *
 * 🔒 **SAMUEL, 2026-09-13, over the Agents tab:** *"On the overview page we see
 * that gray background thing. I like that gray background right behind the white
 * pane. I want us to apply that gray background on top of that Agents page."* It
 * was built the same morning as a file-private `PANEL_WELL` in
 * `features/ontology/components/panel-section.tsx` (his earlier ruling, over the
 * object panel's field sections); the Agents tab is the SECOND reader, and
 * `docs/INVARIANTS.md` §1 forbids a cross-feature import — so the string is here
 * and both features read it. `panel-section.tsx` RE-EXPORTS both constants, so
 * every ontology import path is unchanged.
 *
 * ⚠ **NO HAIRLINE, AND THAT IS THE RULING NOT AN OMISSION** (2026-09-13:
 * *"you're adding this extra border line around the gray. I did not ask for
 * that"*), and since R-39 (2026-09-17) `SECTION_PANEL_GROUND` is flat too — this
 * well is no longer the exception it was written as. It still does not compose
 * that constant: this one has no border box at all, the section ground keeps a
 * transparent one so its callers' pixels do not move.
 *
 * ⚠ **DO NOT RE-TYPE THE RADIUS/PADDING.** A local `rounded-[14px] p-3` is the
 * same well said a second way, and the day the well's geometry moves it would
 * move on one surface.
 *
 * ⚠ **A `.ts` CONSTANTS MODULE, NOT A COMPONENT** — the division
 * `naked-icon-button.ts` holds. The label row, the rows' column and any collapse
 * behaviour stay with the caller, because the two readers compose them
 * differently (an uppercase `text-label` over white bars in the object panel; a
 * `TEMPLATE_NAME_TEXT` heading with a chevron over agent cards on the Agents tab).
 */

import { cn } from "@/shared/lib/utils";
import { SECTION_PANEL_SHELL } from "@/shared/ui/section-panel";

/** The well's GEOMETRY and its column, with no fill — the half both fills share,
 *  stated once so the two can never differ by a radius. */
const WELL_BOX = cn(SECTION_PANEL_SHELL, "flex min-w-0 flex-col gap-2");

/** The gray box the label AND the content sit in. */
export const PANEL_WELL = cn(WELL_BOX, "bg-home-panel");

/**
 * 🔒 **THE SAME WELL FOR A SURFACE THAT IS ALREADY STANDING ON `--home-panel`
 * (2026-09-15).**
 *
 * **SAMUEL, over /home's channel column, verbatim: *"there's no gray background
 * on this at all"*.** The cause was not a missing class — it was `bg-home-panel`
 * doing exactly what it says on a page that is ALREADY `--home-panel`:
 * `pages/home/index.tsx` paints its `<main>` with that very token, so a
 * `PANEL_WELL` drawn in the left column is `#f1f3f5` on `#f1f3f5` and there is
 * nothing to see. ⚠ **IT IS A FILL AND NOT A SECOND LOOK** — Samuel's follow-up
 * the same day was *"just make the gray dropdowns match exactly those"* (the
 * Agents tab's), so the geometry, the header and the collapse are shared and only
 * the colour moves. ⚠ **EVERY OTHER READER OF `PANEL_WELL` SITS ON WHITE** — the
 * Agents and Threads tabs and the Overview's usage well all render inside /home's
 * record pane or a workspace page card, which is what makes that token read as
 * "the gray behind the white pane" in Samuel's original ruling.
 *
 * ⚠ **THE FILL IS `--seg-fill` (#e9eaec), MEASURED AND NOT INVENTED.** It is the
 * ONE gray this app already draws ON `--home-panel` and it is on /home already:
 * the page header's own tab selector is `SegmentedControl variant="plain"`, whose
 * unselected pills wear `bg-[var(--seg-fill)]` against this exact ground
 * (`shared/ui/segmented-control.tsx`, Samuel's 2026-09-08 review). ⚠ **NOT
 * `--bg-inset` (#f1f1f1)**, which is 0/2/4 from the panel and would have shipped
 * the same complaint back; ⚠ **NOT `--card-surface-subtle` (#f4f6f9)**, which is
 * LIGHTER than the ground; ⚠ **NOT a newly minted hex** — a fourth gray for one
 * box is the drift `--seg-fill`'s own comment was written to stop.
 *
 * ⚠ **THE GEOMETRY IS `PANEL_WELL`'s, BY CONSTRUCTION** (`WELL_BOX` above): the
 * radius and padding move for both fills at once, or this is a second well.
 */
export const PANEL_WELL_ON_PANEL = cn(WELL_BOX, "bg-[var(--seg-fill)]");

/** THE CONTENT COLUMN inside the well — direction and gap only, no surface. */
export const PANEL_ROWS = "flex min-w-0 flex-col gap-2";

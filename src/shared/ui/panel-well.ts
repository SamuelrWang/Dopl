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
 * ⚠ **NO HAIRLINE, AND THAT IS THE RULING NOT AN OMISSION.**
 * `SECTION_PANEL_GROUND` is the WORKSPACE-page ground and carries
 * `border-border-subtle`; the Overview panel Samuel pointed at has none
 * (2026-09-13: *"you're adding this extra border line around the gray. I did not
 * ask for that"*). Do not compose it here.
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

/** The gray box the label AND the content sit in. */
export const PANEL_WELL = cn(
  SECTION_PANEL_SHELL,
  "bg-home-panel flex min-w-0 flex-col gap-2"
);

/** THE CONTENT COLUMN inside the well — direction and gap only, no surface. */
export const PANEL_ROWS = "flex min-w-0 flex-col gap-2";

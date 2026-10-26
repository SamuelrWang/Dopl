/**
 * The gray well: `SECTION_PANEL_SHELL`'s radius + padding filled with `--home-panel`, with the
 * label inside it. Shared by the channel page's collapsible wells. No hairline on purpose.
 * Constants only: the label row, column and collapse stay with each caller. Never re-type the
 * radius/padding locally.
 */

import { cn } from "@/shared/lib/utils";
import { SECTION_PANEL_SHELL } from "@/shared/ui/section-panel";

/** The gray box the label and the content sit in. */
export const PANEL_WELL = cn(SECTION_PANEL_SHELL, "flex min-w-0 flex-col gap-2 bg-home-panel");

/** The content column inside the well: direction and gap only, no surface. */
export const PANEL_ROWS = "flex min-w-0 flex-col gap-2";

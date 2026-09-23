/**
 * The gray well: `SECTION_PANEL_SHELL`'s radius + padding filled with `--home-panel`, with the
 * label inside it. Shared by ontology panel sections and the Agents tab (INVARIANTS §1 forbids the
 * cross-feature import). No hairline on purpose. Constants only: the label row, column and
 * collapse stay with each caller. Never re-type the radius/padding locally.
 */

import { cn } from "@/shared/lib/utils";
import { SECTION_PANEL_SHELL } from "@/shared/ui/section-panel";

/** The well's geometry and column, no fill: shared by both fills so they never differ. */
const WELL_BOX = cn(SECTION_PANEL_SHELL, "flex min-w-0 flex-col gap-2");

/** The gray box the label and the content sit in. */
export const PANEL_WELL = cn(WELL_BOX, "bg-home-panel");

/**
 * The same well for a surface already standing on `--home-panel` (/home's channel column), where
 * `bg-home-panel` would be invisible. Only the fill moves: `--seg-fill`, the one gray the app
 * already draws on that ground (the header's `plain` segmented pills). Not `--bg-inset` (too
 * close) or `--card-surface-subtle` (lighter than the ground).
 */
export const PANEL_WELL_ON_PANEL = cn(WELL_BOX, "bg-[var(--seg-fill)]");

/** The content column inside the well: direction and gap only, no surface. */
export const PANEL_ROWS = "flex min-w-0 flex-col gap-2";

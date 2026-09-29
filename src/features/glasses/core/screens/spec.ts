/**
 * The agent-facing screen vocabulary (`glasses_render` blocks). Platform-neutral:
 * each platform compiles these blocks against its own display (`platforms/`).
 * Contract: docs/glasses-mcp.md.
 */

export type BlockType = "text" | "list" | "progress" | "divider" | "spacer";
export const BLOCK_TYPES: readonly BlockType[] = ["text", "list", "progress", "divider", "spacer"];
export type ScreenLayout = "stack" | "absolute";

type ScreenErrorCode =
  | "too_many_blocks"
  | "text_too_long"
  | "overflow"
  | "out_of_bounds"
  | "multiple_selectable"
  | "list_too_long"
  | "overlaps_nav_footer"
  | "item_too_long"
  | "bad_value";

export interface ScreenError {
  block?: string;
  code: ScreenErrorCode;
  message: string;
}

/** A platform's per-screen budgets, enforced before layout. */
export interface ScreenLimits {
  max_blocks: number;
  max_text_blocks: number;
  text_bytes: number;
  list_items: number;
  selectable_list_items: number;
  list_item_bytes: number;
  one_selectable_per_screen: boolean;
  max_lines_per_text: number;
  label_bytes: number;
}

export const BLOCKS_DOC =
  "Blocks: text{content, lines?, brightness?0-4, border?} | list{items[], selectable?=true (false for info-only; max ONE selectable)} | " +
  "progress{value 0-1, label?} | divider{} | spacer{lines?=1}. Every block may carry id (default b1, b2, ...). " +
  "layout 'absolute': blocks also take x,y (px, required) and w,h (optional).";

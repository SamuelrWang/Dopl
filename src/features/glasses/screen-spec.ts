/**
 * The agent-facing screen vocabulary (`glasses_render` blocks) and the G2 display
 * constants the compiler lays them out against. Wire shape: `types.ts ›
 * ScreenPayload`; contract: docs/glasses-mcp.md.
 */

export const SCREEN_W = 576;
export const SCREEN_H = 288;
/** Outer margin of the stack layout. */
export const MARGIN = 8;
/** Firmware line height (@evenrealities/pretext `line_height`). */
export const LINE_H = 27;
/** The plugin renders every text/list container with paddingLength 4 ... */
export const PAD = 4;
/** ... and borderWidth 2 when `border` is true. */
export const BORDER_W = 2;
/** Assumed list row height (one text line). */
export const LIST_ITEM_H = LINE_H;
/**
 * The bottom band every compiled screen leaves free for the plugin's context
 * back button ("Back to Agent" / "Back to Channel" / "Back Home"): one list row
 * with its padding, rounded up. Agent blocks lay out above it.
 */
export const NAV_FOOTER_H = 40;
export const NAV_FOOTER = { x: 0, y: SCREEN_H - NAV_FOOTER_H, w: SCREEN_W, h: NAV_FOOTER_H } as const;
/** Height agent blocks may use. */
export const CONTENT_H = SCREEN_H - NAV_FOOTER_H;

export const SCREEN_LIMITS = {
  max_blocks: 12,
  max_text_blocks: 8,
  text_bytes: 960,
  list_items: 20,
  /** A selectable list gives its 20th row to the plugin's back item. */
  selectable_list_items: 19,
  list_item_bytes: 63,
  one_selectable_per_screen: true,
  max_lines_per_text: 10,
  label_bytes: 100,
} as const;

export const PROGRESS_FILLED = "█"; // █ (in the G2 font)
export const PROGRESS_EMPTY = "▒"; // ▒ (in the G2 font; ░ and ▓ are NOT)
export const DIVIDER_GLYPH = "─"; // ─

export type BlockType = "text" | "list" | "progress" | "divider" | "spacer";
export const BLOCK_TYPES: readonly BlockType[] = ["text", "list", "progress", "divider", "spacer"];
export type ScreenLayout = "stack" | "absolute";

/** What the agent sends. Loose on purpose: the compiler validates every field. */
interface AgentBlock {
  type: BlockType;
  id?: string;
  content?: string;
  lines?: number;
  brightness?: number;
  border?: boolean;
  items?: string[];
  selectable?: boolean;
  value?: number;
  label?: string;
  x?: number;
  y?: number;
  w?: number;
  h?: number;
  [extra: string]: unknown;
}

export interface ScreenSpec {
  blocks: AgentBlock[];
  layout?: ScreenLayout;
}

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

export const BLOCKS_DOC =
  "Blocks: text{content, lines?, brightness?0-4, border?} | list{items[], selectable?=true (max ONE selectable list)} | " +
  "progress{value 0-1, label?} | divider{} | spacer{lines?=1}. Every block may carry id (default b1, b2, ...). " +
  "layout 'absolute': blocks also take x,y (px, required) and w,h (optional).";

export function glassesCapabilities() {
  return {
    screen: { width: SCREEN_W, height: SCREEN_H },
    /** Usable area: everything above the reserved back-button band. */
    content: { width: SCREEN_W, height: CONTENT_H },
    nav_footer: NAV_FOOTER,
    text_brightness: "0-4",
    limits: {
      max_blocks: SCREEN_LIMITS.max_blocks,
      max_text_blocks: SCREEN_LIMITS.max_text_blocks,
      text_bytes: SCREEN_LIMITS.text_bytes,
      list_items: SCREEN_LIMITS.list_items,
      selectable_list_items: SCREEN_LIMITS.selectable_list_items,
      list_item_bytes: SCREEN_LIMITS.list_item_bytes,
      one_selectable_per_screen: SCREEN_LIMITS.one_selectable_per_screen,
    },
    block_types: [
      { type: "text", fields: "content (<=960 bytes), lines? (fixed height in lines; default = wrapped height), brightness? 0-4, border? bool" },
      { type: "list", fields: "items[] (1-19 when selectable, 1-20 otherwise; each <=63 bytes), selectable? (default true; at most one selectable list per screen, it receives taps; the plugin adds a back item)" },
      { type: "progress", fields: `value 0-1, label?; compiled to one text line like 'label ${PROGRESS_FILLED.repeat(5)}${PROGRESS_EMPTY.repeat(5)} 50%'` },
      { type: "divider", fields: `none; compiled to a line of '${DIVIDER_GLYPH}'` },
      { type: "spacer", fields: "lines? (default 1); empty vertical space, no container" },
    ],
    layouts: {
      stack: `default. Top-down, ${MARGIN}px margins, full width, above the ${NAV_FOOTER_H}px back-button band; heights measured with the G2 font (@evenrealities/pretext).`,
      absolute: `each block adds x, y (px) and optionally w, h; must stay inside ${SCREEN_W}x${CONTENT_H} (y >= ${CONTENT_H} is the back-button band).`,
    },
    container_box: { padding: PAD, border_width: BORDER_W, line_height: LINE_H },
    notes:
      `No font sizes or alignment. ~${LINE_H}px per line. Text is sanitized (no emoji; curly quotes/long dashes converted). ` +
      "Only one container takes input: the selectable list, else the last text block (a tap sends choice 'click'). " +
      "The bottom band always shows the plugin's back button; the wearer may leave (dismiss) any screen with it. " +
      "Use validate_only:true to get the compiled layout and an ASCII preview without sending.",
  };
}

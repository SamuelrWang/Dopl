import type { ScreenLimits } from "../../core/screens/spec";

/** The G2 lens and the plugin's container box model the compiler lays blocks out against. */

export const SCREEN_W = 576;
export const SCREEN_H = 288;
/** Outer margin of the stack layout. */
export const MARGIN = 8;
/** Firmware line height (@evenrealities/pretext `line_height`). */
export const LINE_H = 27;
/**
 * A G2 list container row: the firmware draws list rows 40px apart (a text line plus the
 * selection border's box), not {@link LINE_H}. Measured on the simulator framebuffer.
 */
export const LIST_ROW_H = 40;
/** The plugin renders every text/list container with paddingLength 4 ... */
export const PAD = 4;
/** ... and borderWidth 2 when `border` is true. */
export const BORDER_W = 2;
/**
 * The bottom band every compiled screen leaves free for the plugin's context
 * back button: one list row with its padding, rounded up.
 */
export const NAV_FOOTER_H = 40;
export const NAV_FOOTER = { x: 0, y: SCREEN_H - NAV_FOOTER_H, w: SCREEN_W, h: NAV_FOOTER_H } as const;
export const CONTENT_H = SCREEN_H - NAV_FOOTER_H;

/**
 * The plugin's Read / Conversation page (`plugin/src/platform/even-g2/containers.ts › CHAT`): a
 * 30px header, the message body at y 30-202, then the footer list (y 204, 84px). A channel
 * display is compiled into the body rect, full width; its selectable list goes to the footer.
 */
export const CHAT_AREA = { x: 0, y: 30, w: SCREEN_W, h: 172 } as const;
/** Display containers per chat page: the page's header and footer list take the other two. */
export const CHAT_MAX_CONTAINERS = 6;
/**
 * A display taller than the chat area continues on further reader pages (`pages`), at most this
 * many; past it the degradation ladder shortens it, and the text fallback is cut with `+N more`.
 */
export const CHAT_MAX_PAGES = 6;

export const SCREEN_LIMITS: ScreenLimits = {
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
};

// In the G2 font; the lighter shades ░ and ▓ are not.
export const PROGRESS_FILLED = "█";
export const PROGRESS_EMPTY = "▒";
export const DIVIDER_GLYPH = "─";

/** Text width inside a full-width card (576 - 2*8 margin - 2*4 padding - slack). */
export const CARD_LINE_WIDTH_PX = 536;

export const RENDER_HINT = `${SCREEN_W}x${CONTENT_H} usable; the bottom ${NAV_FOOTER_H}px is the wearer's back button, max ${SCREEN_LIMITS.max_text_blocks} text/list blocks`;

export function capabilities() {
  const L = SCREEN_LIMITS;
  return {
    screen: { width: SCREEN_W, height: SCREEN_H },
    /** Usable area: everything above the reserved back-button band. */
    content: { width: SCREEN_W, height: CONTENT_H },
    nav_footer: NAV_FOOTER,
    text_brightness: "0-4",
    limits: {
      max_blocks: L.max_blocks,
      max_text_blocks: L.max_text_blocks,
      text_bytes: L.text_bytes,
      list_items: L.list_items,
      selectable_list_items: L.selectable_list_items,
      list_item_bytes: L.list_item_bytes,
      one_selectable_per_screen: L.one_selectable_per_screen,
    },
    block_types: [
      { type: "text", fields: "content (<=960 bytes), lines? (fixed height in lines; default = wrapped height), brightness? 0-4, border? bool" },
      { type: "list", fields: `items[] (1-19 when selectable, 1-20 otherwise; each <=63 bytes), selectable? (default true; at most one selectable list per screen, it receives taps; the plugin adds a back item; ${LIST_ROW_H}px per row, scrolls natively). selectable:false is an info list: drawn as text lines '${DIVIDER_GLYPH} item' (${LINE_H}px each), so it must fit` },
      { type: "progress", fields: `value 0-1, label?; compiled to one text line like 'label ${PROGRESS_FILLED.repeat(5)}${PROGRESS_EMPTY.repeat(5)} 50%'` },
      { type: "divider", fields: `none; compiled to a line of '${DIVIDER_GLYPH}'` },
      { type: "spacer", fields: "lines? (default 1); empty vertical space, no container" },
    ],
    layouts: {
      stack: `default. Top-down, ${MARGIN}px margins, full width, above the ${NAV_FOOTER_H}px back-button band; heights measured with the G2 font (@evenrealities/pretext).`,
      absolute: `each block adds x, y (px) and optionally w, h; must stay inside ${SCREEN_W}x${CONTENT_H} (y >= ${CONTENT_H} is the back-button band).`,
    },
    container_box: { padding: PAD, border_width: BORDER_W, line_height: LINE_H, list_row_height: LIST_ROW_H },
    notes:
      `No font sizes or alignment. ~${LINE_H}px per text line, ${LIST_ROW_H}px per selectable list row. Text is sanitized (no emoji; curly quotes/long dashes converted). ` +
      "Only one container takes input: the selectable list, else the last text block (a tap sends choice 'click'). " +
      "The bottom band always shows the plugin's back button; the wearer may leave (dismiss) any screen with it. " +
      "Use validate_only:true to get the compiled layout and an ASCII preview without sending.",
  };
}

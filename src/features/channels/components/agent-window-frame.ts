/**
 * Agent-window geometry that the chrome, rail and shell must agree on. They do not import each
 * other, so each equality is one constant here, pinned in agent-window-frame.test.ts. Tailwind
 * utilities, not CSS tokens: one window's layout stays out of globals.css / tokens.css.
 */

/** One square for the rail's selected tile AND the Dopl mark = the collapsed rail's inner width (56 − 16 − 4). */
export const TILE = "h-9 w-9";

/** The tile's corner, shared by the mark and the rail's rows. */
export const TILE_RADIUS = "rounded-[10px]";

/** Expanded rail padding; the chrome's mark slot takes the rail's padding so the logo aligns with the tiles. */
export const RAIL_PAD = "px-2.5";

/** Asymmetric so a tile is centred between window edge and panel edge: 16 = 4 + FRAME_GAP (12); sum stays 56. */
export const RAIL_PAD_COLLAPSED = "pl-4 pr-1";

/** 56px = {@link TILE} + {@link RAIL_PAD_COLLAPSED}. */
export const RAIL_COLLAPSED = "w-14";

/** 2.5 × {@link RAIL_COLLAPSED}; rail rows truncate rather than widen it. */
export const RAIL_EXPANDED = "w-[140px]";

/** Rail↔panel gap: the tab strip starts at railWidth + FRAME_GAP, which is the panel's left edge. */
export const FRAME_GAP = "gap-3";

/** Fixed height: this row is the frameless window's drag band. */
export const CHROME_ROW = "h-[44px]";

/** Rail row type: size and weight only (ink is state, set at the call site); same size as {@link AGENT_TAB_TEXT}. */
export const AGENT_NAME_TEXT = "text-body font-normal";

/** Tab label: {@link AGENT_NAME_TEXT}'s size, heavier. Its own constant because two `font-*` utilities resolve by
 *  Tailwind emit order, not class order. */
export const AGENT_TAB_TEXT = "text-body font-semibold";

/** A tab hugs its label up to this; past it the label truncates and the × stays visible. */
export const TAB_MAX = "max-w-[200px]";

/** The second line of a rail row — the agent's state, never a timestamp. */
export const AGENT_STATE_TEXT = "text-caption text-text-secondary";

/** Matches `form-dialog.module.css › .line::after` (height read by the test): black, full-bleed, square-ended. */
export const TAB_UNDERLINE_HEIGHT = "h-[2px]";
export const TAB_UNDERLINE = `absolute inset-x-0 bottom-0 ${TAB_UNDERLINE_HEIGHT} bg-text-primary`;

/**
 * The `.bento` card at the window's radius. `min-w-0` must be on every ancestor up to the window too, or
 * the panel cannot shrink when the rail expands; `min-h-0` + `overflow-hidden` let the transcript scroll.
 */
export const INSET_PANEL =
  "bento flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden rounded-[14px]";

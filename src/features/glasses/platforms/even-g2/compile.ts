import type { CompileResult } from "../types";
import { normalizeSpec, type NormBlock } from "../../core/screens/normalize";
import type { ScreenError, ScreenLayout } from "../../core/screens/spec";
import type { ScreenContainer } from "../../core/messages/types";
import { g2Measurer, type TextMeasurer } from "./measure";
import { sanitizeG2Text } from "./text";
import {
  BORDER_W,
  CONTENT_H,
  DIVIDER_GLYPH,
  LINE_H,
  LIST_ROW_H,
  MARGIN,
  NAV_FOOTER,
  NAV_FOOTER_H,
  PAD,
  PROGRESS_EMPTY,
  PROGRESS_FILLED,
  SCREEN_H,
  SCREEN_LIMITS as LIM,
  SCREEN_W,
} from "./display";

/**
 * Blocks → positioned G2 containers. Every text height is measured with the G2
 * font, every list row at the firmware's {@link LIST_ROW_H}; anything that does not
 * fit is a FIXABLE error naming the block and the numbers, never a silent clip.
 * Only the one selectable list is a G2 list container (it takes input and scrolls);
 * an info list is text, `─ item` per line, so it never shows a selection border.
 */

export const box = (border: boolean) => 2 * PAD + (border ? 2 * BORDER_W : 0);
const MIN_LIST_ROWS = 2;
/** The least height a selectable list may shrink to (it scrolls natively below that). */
export const MIN_LIST_H = MIN_LIST_ROWS * LIST_ROW_H + 2 * PAD;
export const INFO_MARK = `${DIVIDER_GLYPH} `;

/** An info (non-selectable) list as the text block the lens draws: one `─ item` line per item. */
export function infoListAsText(b: NormBlock): NormBlock {
  if (b.type !== "list" || b.selectable) return b;
  const { items, ...rest } = b;
  return { ...rest, type: "text", content: (items ?? []).map((i) => INFO_MARK + i).join("\n") };
}

export interface Sized {
  block: NormBlock;
  content?: string;
  /** Height the content needs. */
  natural: number;
}

function progressText(b: NormBlock, inner: number, m: TextMeasurer): string | null {
  const value = b.value ?? 0;
  const pct = ` ${Math.round(value * 100)}%`;
  const label = b.label ? `${b.label} ` : "";
  const cell = m.width(PROGRESS_FILLED);
  const cells = Math.min(10, Math.floor((inner - m.width(label + pct)) / cell));
  if (cells < 4) return null;
  const filled = Math.round(value * cells);
  return label + PROGRESS_FILLED.repeat(filled) + PROGRESS_EMPTY.repeat(cells - filled) + pct;
}

/** Text height: wrapped lines at the G2 font plus the box. */
export const textHeight = (content: string, width: number, border: boolean, m: TextMeasurer) =>
  m.lineCount(content, width - box(border)) * LINE_H + box(border);

export function size(block: NormBlock, width: number, m: TextMeasurer, errors: ScreenError[]): Sized | null {
  const b = infoListAsText(block);
  const inner = width - box(b.border);
  switch (b.type) {
    case "spacer":
      return { block: b, natural: (b.lines ?? 1) * LINE_H };
    case "list":
      return { block: b, natural: (b.items?.length ?? 0) * LIST_ROW_H + 2 * PAD };
    case "divider": {
      const n = Math.max(1, Math.floor(inner / m.width(DIVIDER_GLYPH)));
      return { block: b, content: DIVIDER_GLYPH.repeat(n), natural: LINE_H + box(false) };
    }
    case "progress": {
      const content = progressText(b, inner, m);
      if (!content) {
        errors.push({ block: b.id, code: "text_too_long", message: "label leaves no room for the bar; shorten the label or widen the block" });
        return null;
      }
      return { block: b, content, natural: LINE_H + box(false) };
    }
    case "text": {
      const wrapped = m.lineCount(b.content ?? "", inner);
      if (b.lines !== undefined && wrapped > b.lines) {
        errors.push({
          block: b.id,
          code: "overflow",
          message: `${b.id} wraps to ${wrapped} lines but lines:${b.lines}; raise lines or shorten the text`,
        });
      }
      return { block: b, content: b.content, natural: (b.lines ?? wrapped) * LINE_H + box(b.border) };
    }
  }
}

export function toContainer(s: Sized, x: number, y: number, w: number, h: number): ScreenContainer | null {
  const b = s.block;
  if (b.type === "spacer") return null;
  if (b.type === "list") return { block_id: b.id, kind: "list", x, y, w, h, items: b.items, capture: false };
  const c: ScreenContainer = { block_id: b.id, kind: "text", x, y, w, h, content: s.content, capture: false };
  if (b.brightness !== undefined) c.brightness = b.brightness;
  if (b.border) c.border = true;
  return c;
}

/** Where a stack goes: the lens above the back-button band, inside the margins (the default). */
export interface StackArea {
  x: number;
  y: number;
  w: number;
  h: number;
}
const SCREEN_STACK: StackArea = { x: MARGIN, y: MARGIN, w: SCREEN_W - 2 * MARGIN, h: CONTENT_H - 2 * MARGIN };

export function layoutStack(sized: Sized[], errors: ScreenError[], area: StackArea = SCREEN_STACK): ScreenContainer[] {
  const w = area.w;
  const heights = sized.map((s) => s.natural);
  const available = area.h;
  let total = heights.reduce((a, h) => a + h, 0);
  // The selectable list scrolls natively, so it may give up rows (down to 2) before we call it overflow.
  const li = sized.findIndex((s) => s.block.type === "list");
  if (total > available && li >= 0) {
    const give = Math.min(total - available, Math.max(0, heights[li] - MIN_LIST_H));
    heights[li] -= give;
    total -= give;
  }
  if (total > available) {
    const excess = total - available;
    const tallest = sized
      .filter((s) => s.block.type !== "list")
      .reduce((a, s) => (s.natural > a.natural ? s : a), sized[0]);
    errors.push({
      block: tallest.block.id,
      code: "overflow",
      message: `stack height ${total + 2 * MARGIN}px > ${CONTENT_H}px (the bottom ${NAV_FOOTER_H}px is the back button); remove ${Math.ceil(excess / LINE_H)} line(s) or shorten ${tallest.block.id}`,
    });
    return [];
  }
  const out: ScreenContainer[] = [];
  let y = area.y;
  sized.forEach((s, i) => {
    const c = toContainer(s, area.x, y, w, heights[i]);
    if (c) out.push(c);
    y += heights[i];
  });
  return out;
}

/** Width a block is laid out at: its own in absolute layout, the full stack width otherwise. */
function blockWidth(b: NormBlock, layout: ScreenLayout): number {
  if (layout === "absolute" && b.x !== undefined) return b.w ?? SCREEN_W - MARGIN - b.x;
  return SCREEN_W - 2 * MARGIN;
}

function layoutAbsolute(sized: Sized[], errors: ScreenError[]): ScreenContainer[] {
  const out: ScreenContainer[] = [];
  for (const s of sized) {
    const b = s.block;
    if (b.type === "spacer" || b.x === undefined || b.y === undefined) continue;
    const w = blockWidth(b, "absolute");
    const h = b.h ?? s.natural;
    if (w <= 0 || h <= 0 || b.x + w > SCREEN_W || b.y + h > SCREEN_H) {
      errors.push({
        block: b.id,
        code: "out_of_bounds",
        message: `${b.id} spans x ${b.x}-${b.x + w}, y ${b.y}-${b.y + h}; must fit inside ${SCREEN_W}x${SCREEN_H}`,
      });
      continue;
    }
    if (b.y + h > NAV_FOOTER.y) {
      errors.push({
        block: b.id,
        code: "overlaps_nav_footer",
        message: `${b.id} ends at y ${b.y + h}; y >= ${NAV_FOOTER.y} is reserved for the back button. Move it up or shrink h by ${b.y + h - NAV_FOOTER.y}px`,
      });
      continue;
    }
    const need = b.type === "list" ? MIN_LIST_H : s.natural;
    if (h < need) {
      errors.push({ block: b.id, code: "overflow", message: `${b.id} needs ${need}px of height; h is ${h}` });
      continue;
    }
    const c = toContainer(s, b.x, b.y, w, h);
    if (c) out.push(c);
  }
  return out;
}

export function compileScreen(
  spec: unknown,
  screenId: string,
  m: TextMeasurer = g2Measurer,
): CompileResult {
  const { layout, blocks, errors } = normalizeSpec(spec, { limits: LIM, sanitize: sanitizeG2Text });
  const containerCount = blocks.filter((b) => b.type !== "spacer").length;
  if (containerCount > LIM.max_text_blocks) {
    errors.push({
      code: "too_many_blocks",
      message: `${containerCount} text/list/progress/divider blocks; max ${LIM.max_text_blocks}. Merge text blocks.`,
    });
  }
  if (containerCount === 0 && blocks.length > 0) {
    errors.push({ code: "bad_value", message: "screen needs at least one text, list, progress or divider block" });
  }
  if (errors.length) return { ok: false, errors };

  const sized = blocks
    .map((b) => size(b, Math.max(1, blockWidth(b, layout)), m, errors))
    .filter((s): s is Sized => s !== null);
  const containers = layout === "absolute" ? layoutAbsolute(sized, errors) : layoutStack(sized, errors);
  if (errors.length) return { ok: false, errors };

  const selectable = blocks.find((b) => b.selectable);
  // Else the last text container that is not an info list (those are text on the lens, lists to the agent).
  const lists = new Set(blocks.filter((b) => b.type === "list").map((b) => b.id));
  const capture = selectable
    ? containers.find((c) => c.block_id === selectable.id)
    : ([...containers].reverse().find((c) => c.kind === "text" && !lists.has(c.block_id)) ?? containers.at(-1));
  if (capture) capture.capture = true;
  return { ok: true, payload: { screen_id: screenId, spec_version: 1, containers, nav_footer: { ...NAV_FOOTER } } };
}

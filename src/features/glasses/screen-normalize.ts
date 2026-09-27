import { sanitizeGlassesText, utf8Bytes } from "./text";
import {
  BLOCK_TYPES,
  SCREEN_LIMITS as LIM,
  type BlockType,
  type ScreenError,
  type ScreenLayout,
} from "./screen-spec";

/**
 * Pass 1 of the screen compiler: turn the agent's loose JSON into checked,
 * sanitized blocks, collecting EVERY problem as a fixable error (never
 * truncating). Geometry is pass 2 (`screen-compile.ts`).
 */

export interface NormBlock {
  id: string;
  type: BlockType;
  content?: string;
  items?: string[];
  lines?: number;
  brightness?: number;
  border: boolean;
  selectable: boolean;
  value?: number;
  label?: string;
  x?: number;
  y?: number;
  w?: number;
  h?: number;
}

const ID_RE = /^[A-Za-z0-9_-]{1,32}$/;
const GEOMETRY = ["x", "y", "w", "h"] as const;

function isObj(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function intIn(v: unknown, min: number, max: number): v is number {
  return typeof v === "number" && Number.isInteger(v) && v >= min && v <= max;
}

export function normalizeSpec(spec: unknown): {
  layout: ScreenLayout;
  blocks: NormBlock[];
  errors: ScreenError[];
} {
  const errors: ScreenError[] = [];
  const bad = (block: string | undefined, message: string) =>
    errors.push({ block, code: "bad_value", message });
  const s = isObj(spec) ? spec : {};
  const layout: ScreenLayout = s.layout === "absolute" ? "absolute" : "stack";
  if (s.layout !== undefined && s.layout !== "stack" && s.layout !== "absolute") {
    bad(undefined, "layout must be 'stack' or 'absolute'");
  }
  if (!Array.isArray(s.blocks) || s.blocks.length === 0) {
    bad(undefined, "blocks must be a non-empty array");
    return { layout, blocks: [], errors };
  }
  if (s.blocks.length > LIM.max_blocks) {
    errors.push({
      code: "too_many_blocks",
      message: `${s.blocks.length} blocks; max ${LIM.max_blocks}. Merge text blocks or drop spacers.`,
    });
  }

  const seen = new Set<string>();
  const blocks: NormBlock[] = [];
  s.blocks.forEach((raw, i) => {
    const b = isObj(raw) ? raw : {};
    let id = `b${i + 1}`;
    if (b.id !== undefined) {
      if (typeof b.id === "string" && ID_RE.test(b.id)) id = b.id;
      else bad(id, `blocks[${i}].id must be 1-32 chars of A-Z a-z 0-9 _ -`);
    }
    if (seen.has(id)) bad(id, `duplicate block id '${id}'`);
    seen.add(id);
    if (!BLOCK_TYPES.includes(b.type as BlockType)) {
      bad(id, `type must be one of ${BLOCK_TYPES.join(", ")}`);
      return;
    }
    const n: NormBlock = { id, type: b.type as BlockType, border: false, selectable: false };

    for (const g of GEOMETRY) {
      if (b[g] === undefined) continue;
      if (layout !== "absolute") bad(id, `${g} is only used with layout:'absolute'`);
      else if (!intIn(b[g], 0, 10_000)) bad(id, `${g} must be a whole number of px`);
      else n[g] = b[g] as number;
    }
    if (layout === "absolute" && n.type !== "spacer" && (b.x === undefined || b.y === undefined)) {
      bad(id, "absolute layout needs x and y on every block");
    }

    if (n.type === "text") {
      const content = typeof b.content === "string" ? sanitizeGlassesText(b.content) : "";
      if (!content) bad(id, "text needs non-empty content");
      else if (utf8Bytes(content) > LIM.text_bytes) {
        errors.push({
          block: id,
          code: "text_too_long",
          message: `content is ${utf8Bytes(content)} bytes; max ${LIM.text_bytes}. Shorten it or split it.`,
        });
      }
      n.content = content;
      if (b.lines !== undefined) {
        if (intIn(b.lines, 1, LIM.max_lines_per_text)) n.lines = b.lines;
        else bad(id, `lines must be 1-${LIM.max_lines_per_text}`);
      }
      if (b.brightness !== undefined) {
        if (intIn(b.brightness, 0, 4)) n.brightness = b.brightness;
        else bad(id, "brightness must be 0-4");
      }
      if (b.border !== undefined) n.border = b.border === true;
    } else if (n.type === "list") {
      normalizeList(b, n, errors);
    } else if (n.type === "progress") {
      if (typeof b.value === "number" && b.value >= 0 && b.value <= 1) n.value = b.value;
      else bad(id, "progress value must be a number from 0 to 1");
      if (b.label !== undefined) {
        const label = typeof b.label === "string" ? sanitizeGlassesText(b.label) : "";
        if (utf8Bytes(label) > LIM.label_bytes) {
          errors.push({ block: id, code: "text_too_long", message: `label is ${utf8Bytes(label)} bytes; max ${LIM.label_bytes}` });
        }
        n.label = label;
      }
    } else if (n.type === "spacer") {
      if (b.lines === undefined) n.lines = 1;
      else if (intIn(b.lines, 1, 10)) n.lines = b.lines;
      else bad(id, "spacer lines must be 1-10");
    }
    blocks.push(n);
  });

  const selectable = blocks.filter((b) => b.selectable).map((b) => b.id);
  if (selectable.length > 1) {
    errors.push({
      block: selectable[1],
      code: "multiple_selectable",
      message: `${selectable.length} selectable lists (${selectable.join(", ")}); max 1. Set selectable:false on all but one.`,
    });
  }
  return { layout, blocks, errors };
}

function normalizeList(b: Record<string, unknown>, n: NormBlock, errors: ScreenError[]) {
  const id = n.id;
  n.selectable = b.selectable !== false;
  if (!Array.isArray(b.items) || b.items.length === 0) {
    errors.push({ block: id, code: "bad_value", message: "list needs a non-empty items array" });
    n.items = [];
    return;
  }
  const max = n.selectable ? LIM.selectable_list_items : LIM.list_items;
  if (b.items.length > max) {
    errors.push({
      block: id,
      code: "list_too_long",
      message: n.selectable
        ? `${b.items.length} items; max ${max} in a selectable list (the 20th row is the back button)`
        : `${b.items.length} items; max ${max}`,
    });
  }
  n.items = b.items.map((item, j) => {
    const clean = typeof item === "string" ? sanitizeGlassesText(item) : "";
    if (!clean) {
      errors.push({ block: id, code: "bad_value", message: `items[${j}] must be non-empty text` });
    } else if (utf8Bytes(clean) > LIM.list_item_bytes) {
      errors.push({
        block: id,
        code: "item_too_long",
        message: `items[${j}] is ${utf8Bytes(clean)} bytes; max ${LIM.list_item_bytes}`,
      });
    }
    return clean;
  });
}

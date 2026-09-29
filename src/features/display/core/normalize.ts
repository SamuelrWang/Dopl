import {
  BLOCK_ID_RE,
  BLOCK_TYPES,
  DISPLAY_LIMITS as L,
  type BlockType,
  type ChoiceOption,
  type DisplayBlock,
  type DisplayError,
  type DisplayErrorCode,
  type DisplayLayout,
  type Positioned,
} from "./types";

/**
 * The agent's loose JSON → checked, sanitized {@link DisplayBlock}s under the NEUTRAL limits
 * (spec §2.2). Every problem is collected, never truncated; an unknown key is an error naming it.
 * Surfaces re-check against their own budgets at render (`degrade.ts`, the G2 compiler).
 */

export type NormalizeResult =
  | { ok: true; display: { blocks: Positioned<DisplayBlock>[]; layout: DisplayLayout } }
  | { ok: false; errors: DisplayError[] };

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);
const intIn = (v: unknown, min: number, max: number): v is number =>
  typeof v === "number" && Number.isInteger(v) && v >= min && v <= max;

// C0 controls (newline and tab kept) and DEL: nothing any renderer should draw.
const CONTROL = /[\u0000-\u0008\u000B-\u001F\u007F]/g;
export const cleanDisplayText = (s: string) => s.replace(CONTROL, "").trim();

const GEOMETRY = ["x", "y", "w", "h"] as const;
const KEYS: Record<BlockType, readonly string[]> = {
  heading: ["text"],
  text: ["content", "tone", "lines", "brightness", "border"],
  fields: ["rows"],
  list: ["items", "style"],
  choice: ["options"],
  progress: ["value", "label"],
  table: ["columns", "rows"],
  divider: [],
  spacer: ["lines"],
};
const OPTION_KEYS = ["label", "description", "recommended", "why"];

/**
 * v1 blocks (the glasses vocabulary) → v2 shape, before validation (spec §2.3): a selectable list
 * (v1's default) is a `choice`, an info list stays a `list`, everything else carries over.
 */
export function fromV1(blocks: unknown[]): unknown[] {
  return blocks.map((raw) => {
    if (!isObj(raw)) return raw;
    // Stored v1 blocks carry the old normalizer's `selectable`/`border` defaults on every type.
    const { selectable, border, ...rest } = raw;
    if (rest.type === "text") return border === undefined ? rest : { ...rest, border };
    if (rest.type !== "list") return rest;
    const { items, ...list } = rest;
    if (selectable === false) return { ...list, items };
    return { ...list, type: "choice", options: Array.isArray(items) ? items.map((label) => ({ label })) : items };
  });
}

/** v2 input leniency: a list with `selectable:true` is a choice; `selectable:false` is ignored. */
function aliasSelectable(raw: unknown): unknown {
  if (!isObj(raw) || raw.type !== "list" || !("selectable" in raw)) return raw;
  if (raw.selectable === true) return fromV1([raw])[0];
  const rest = { ...raw };
  delete rest.selectable;
  return rest;
}

class Collector {
  errors: DisplayError[] = [];
  add(block: string | undefined, code: DisplayErrorCode, message: string) {
    this.errors.push({ block, code, message });
  }
  /** A required string: cleaned, 1..max chars, one line unless `multiline`. */
  str(block: string, field: string, v: unknown, max: number, opts: { multiline?: boolean; optional?: boolean } = {}) {
    if (v === undefined && opts.optional) return undefined;
    const s = typeof v === "string" ? cleanDisplayText(v) : "";
    if (!s) {
      if (!opts.optional || v !== "") this.add(block, "bad_value", `${field} must be non-empty text`);
      return opts.optional ? undefined : s;
    }
    if (!opts.multiline && /\n/.test(s)) this.add(block, "bad_value", `${field} must be one line`);
    if (s.length > max) this.add(block, "text_too_long", `${field} is ${s.length} chars; max ${max}`);
    return s;
  }
  strings(block: string, field: string, v: unknown, maxItems: number, maxLen: number, minItems = 1) {
    if (!Array.isArray(v) || v.length < minItems) {
      this.add(block, "bad_value", `${field} needs ${minItems === 1 ? "a non-empty array" : `at least ${minItems} entries`}`);
      return [];
    }
    if (v.length > maxItems) this.add(block, "list_too_long", `${field} has ${v.length} entries; max ${maxItems}`);
    return v.map((x, i) => this.str(block, `${field}[${i}]`, x, maxLen) as string);
  }
}

export function normalizeDisplay(input: unknown, opts: { version?: 1 | 2 } = {}): NormalizeResult {
  const c = new Collector();
  const s = isObj(input) ? input : {};
  if (s.layout !== undefined && s.layout !== "stack" && s.layout !== "absolute") {
    c.add(undefined, "bad_value", "layout must be 'stack' or 'absolute'");
  }
  const layout: DisplayLayout = s.layout === "absolute" ? "absolute" : "stack";
  if (!Array.isArray(s.blocks) || s.blocks.length === 0) {
    c.add(undefined, "bad_value", "blocks must be a non-empty array");
    return { ok: false, errors: c.errors };
  }
  if (s.blocks.length > L.blocks) {
    c.add(undefined, "too_many_blocks", `${s.blocks.length} blocks; max ${L.blocks}`);
  }
  const raws = opts.version === 1 ? fromV1(s.blocks) : s.blocks.map(aliasSelectable);

  const seen = new Set<string>();
  const blocks: Positioned<DisplayBlock>[] = [];
  raws.forEach((raw, i) => {
    const b = isObj(raw) ? raw : {};
    let id = `b${i + 1}`;
    if (b.id !== undefined) {
      if (typeof b.id === "string" && BLOCK_ID_RE.test(b.id)) id = b.id;
      else c.add(id, "bad_value", `blocks[${i}].id must be 1-32 chars of A-Z a-z 0-9 _ -`);
    }
    if (seen.has(id)) c.add(id, "duplicate_id", `duplicate block id '${id}'`);
    seen.add(id);
    if (!BLOCK_TYPES.includes(b.type as BlockType)) {
      c.add(id, "bad_value", `type must be one of ${BLOCK_TYPES.join(", ")}`);
      return;
    }
    const type = b.type as BlockType;
    const allowed = new Set<string>(["type", "id", ...KEYS[type], ...(layout === "absolute" ? GEOMETRY : [])]);
    for (const k of Object.keys(b)) {
      if (allowed.has(k)) continue;
      const why = (GEOMETRY as readonly string[]).includes(k) ? ` (only with layout:"absolute")` : "";
      c.add(id, "unknown_key", `${type} has no '${k}'${why}; keys: ${KEYS[type].join(", ") || "none"}`);
    }
    const block = normalizeBlock(c, id, type, b);
    if (layout === "absolute") {
      for (const g of GEOMETRY) {
        if (b[g] === undefined) continue;
        if (intIn(b[g], 0, 10_000)) (block as unknown as Obj)[g] = b[g];
        else c.add(id, "bad_value", `${g} must be a whole number of px`);
      }
      if (type !== "spacer" && (b.x === undefined || b.y === undefined)) {
        c.add(id, "bad_value", "absolute layout needs x and y on every block");
      }
    }
    blocks.push(block);
  });

  const choices = blocks.filter((b) => b.type === "choice");
  if (choices.length > 1) {
    c.add(choices[1].id, "multiple_choice", `${choices.length} choice blocks (${choices.map((b) => b.id).join(", ")}); max 1 per display`);
  }
  return c.errors.length ? { ok: false, errors: c.errors } : { ok: true, display: { blocks, layout } };
}

function normalizeBlock(c: Collector, id: string, type: BlockType, b: Obj): Positioned<DisplayBlock> {
  switch (type) {
    case "heading":
      return { id, type, text: c.str(id, "text", b.text, L.heading) as string };
    case "text": {
      const out: Extract<DisplayBlock, { type: "text" }> = {
        id,
        type,
        content: c.str(id, "content", b.content, L.text, { multiline: true }) as string,
      };
      if (b.tone !== undefined) {
        if (b.tone === "muted" || b.tone === "strong") out.tone = b.tone;
        else c.add(id, "bad_value", "tone must be 'muted' or 'strong'");
      }
      if (b.lines !== undefined) {
        if (intIn(b.lines, 1, L.textLines)) out.lines = b.lines;
        else c.add(id, "bad_value", `lines must be 1-${L.textLines}`);
      }
      if (b.brightness !== undefined) {
        if (intIn(b.brightness, 0, 4)) out.brightness = b.brightness as 0 | 1 | 2 | 3 | 4;
        else c.add(id, "bad_value", "brightness must be 0-4");
      }
      if (b.border !== undefined) {
        if (typeof b.border === "boolean") {
          if (b.border) out.border = true;
        } else c.add(id, "bad_value", "border must be true or false");
      }
      return out;
    }
    case "fields": {
      if (!Array.isArray(b.rows) || b.rows.length === 0) {
        c.add(id, "bad_value", "rows needs a non-empty array of {label, value}");
        return { id, type, rows: [] };
      }
      if (b.rows.length > L.fieldsRows) c.add(id, "list_too_long", `rows has ${b.rows.length} entries; max ${L.fieldsRows}`);
      const rows = b.rows.map((r, i) => {
        const row = isObj(r) ? r : {};
        for (const k of Object.keys(row)) {
          if (k !== "label" && k !== "value") c.add(id, "unknown_key", `rows[${i}] has no '${k}'; keys: label, value`);
        }
        return {
          label: c.str(id, `rows[${i}].label`, row.label, L.fieldLabel) as string,
          value: c.str(id, `rows[${i}].value`, typeof row.value === "number" ? String(row.value) : row.value, L.fieldValue) as string,
        };
      });
      return { id, type, rows };
    }
    case "list": {
      const out: Extract<DisplayBlock, { type: "list" }> = { id, type, items: c.strings(id, "items", b.items, L.listItems, L.listItem) };
      if (b.style !== undefined) {
        if (b.style === "number") out.style = "number";
        else if (b.style !== "bullet") c.add(id, "bad_value", "style must be 'number' (omit for bullets)");
      }
      return out;
    }
    case "choice":
      return { id, type, options: normalizeOptions(c, id, b.options) };
    case "progress": {
      const out: Extract<DisplayBlock, { type: "progress" }> = { id, type, value: 0 };
      if (typeof b.value === "number" && b.value >= 0 && b.value <= 1) out.value = b.value;
      else c.add(id, "bad_value", "value must be a number from 0 to 1");
      const label = c.str(id, "label", b.label, L.progressLabel, { optional: true });
      if (label) out.label = label;
      return out;
    }
    case "table": {
      const columns = c.strings(id, "columns", b.columns, L.tableColumns.max, L.tableColumn, L.tableColumns.min);
      if (!Array.isArray(b.rows) || b.rows.length === 0) {
        c.add(id, "bad_value", "rows needs a non-empty array of rows");
        return { id, type, columns, rows: [] };
      }
      if (b.rows.length > L.tableRows) c.add(id, "list_too_long", `rows has ${b.rows.length} rows; max ${L.tableRows}`);
      const rows = b.rows.map((r, i) => {
        if (!Array.isArray(r) || r.length !== columns.length) {
          c.add(id, "table_shape", `rows[${i}] must have exactly ${columns.length} cells (one per column)`);
          return [];
        }
        return r.map((cell, j) => c.str(id, `rows[${i}][${j}]`, typeof cell === "number" ? String(cell) : cell, L.tableCell) as string);
      });
      return { id, type, columns, rows };
    }
    case "divider":
      return { id, type };
    case "spacer": {
      if (b.lines === undefined) return { id, type };
      if (intIn(b.lines, 1, L.spacerLines)) return { id, type, lines: b.lines };
      c.add(id, "bad_value", `spacer lines must be 1-${L.spacerLines}`);
      return { id, type };
    }
  }
}

function normalizeOptions(c: Collector, id: string, raw: unknown): ChoiceOption[] {
  const { min, max } = L.options;
  if (!Array.isArray(raw) || raw.length < min) {
    c.add(id, "bad_value", `options needs ${min}-${max} entries`);
    return [];
  }
  if (raw.length > max) c.add(id, "list_too_long", `options has ${raw.length} entries; max ${max}`);
  let recommended = 0;
  const options = raw.map((r, i) => {
    const o = isObj(r) ? r : typeof r === "string" ? { label: r } : {};
    for (const k of Object.keys(o)) {
      if (!OPTION_KEYS.includes(k)) c.add(id, "unknown_key", `options[${i}] has no '${k}'; keys: ${OPTION_KEYS.join(", ")}`);
    }
    const out: ChoiceOption = { label: c.str(id, `options[${i}].label`, o.label, L.optionLabel) as string };
    const description = c.str(id, `options[${i}].description`, o.description, L.optionDescription, { optional: true });
    if (description) out.description = description;
    if (o.recommended === true) {
      out.recommended = true;
      recommended++;
    } else if (o.recommended !== undefined && o.recommended !== false) {
      c.add(id, "bad_value", `options[${i}].recommended must be true (or omitted)`);
    }
    const why = c.str(id, `options[${i}].why`, o.why, L.optionWhy, { optional: true });
    if (why) {
      if (out.recommended) out.why = why;
      else c.add(id, "bad_recommendation", `options[${i}].why belongs on the recommended option only`);
    }
    return out;
  });
  if (recommended > 1) c.add(id, "bad_recommendation", `${recommended} options are recommended; at most one`);
  return options;
}

/** One line per error, for surfaces that report text (the tool error stays the JSON list). */
export const formatDisplayErrors = (errors: DisplayError[]) =>
  errors.map((e) => (e.block ? `${e.block}: ${e.message}` : e.message)).join("; ");

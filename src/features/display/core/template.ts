import { BLOCK_TYPES, DISPLAY_LIMITS, DISPLAY_SPEC_VERSION, type DisplayLayout } from "./types";

/**
 * **SAVED DISPLAY TEMPLATES** (table `glasses_templates`; spec §3.6). A stored spec is
 * `{spec_version: 2, blocks, layout?}` whose strings may hold `{{var}}` placeholders; one without
 * `spec_version` is v1 and is read through `fromV1` at use. Filling is structural, not textual:
 *   - `"Build {{name}}"` → string interpolation;
 *   - a field that is EXACTLY `"{{var}}"` takes the value's own type (`value: "{{pct}}"` → a number);
 *   - a list item (or a choice option `{label}`) that is exactly `"{{var}}"` with an ARRAY value is
 *     spread in.
 * Save checks structure only (placeholders are not values yet); use runs the full normalizer.
 */

export class DisplayInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DisplayInputError";
  }
}

/** v2 carries `spec_version: 2`; a v1 template (glasses_save_template) has none and stays v1. */
export interface StoredTemplateSpec {
  spec_version?: typeof DISPLAY_SPEC_VERSION;
  blocks: Record<string, unknown>[];
  layout?: "absolute";
}

const NAME_RE = /^[a-z0-9][a-z0-9_-]{0,63}$/;
const PLACEHOLDER = /\{\{\s*([A-Za-z0-9_]+)\s*\}\}/g;
const WHOLE = /^\{\{\s*([A-Za-z0-9_]+)\s*\}\}$/;
const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

export function cleanTemplateName(name: unknown): string {
  const n = typeof name === "string" ? name.trim().toLowerCase() : "";
  if (!NAME_RE.test(n)) {
    throw new DisplayInputError("name must be 1-64 chars: a-z 0-9 _ - (starting with a letter or digit)");
  }
  return n;
}

/** `a-z 0-9 _ -`, ≤64, from free text (a display's first line) — the Save button's default name. */
export function templateNameFrom(raw: string | undefined, fallback: string): string {
  const slug = (raw?.trim() || fallback).toLowerCase().replace(/[^a-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 64);
  return slug || "display";
}

/**
 * Structural check at save time. `version: 1` input (glasses_save_template) is stored AS v1, so a
 * one-item selectable list keeps v1's bounds when it is used (`templateSpecOf` → `fromV1`).
 */
export function checkTemplateSpec(spec: { blocks?: unknown; layout?: unknown }, version: 1 | 2 = 2): StoredTemplateSpec {
  if (!Array.isArray(spec.blocks) || spec.blocks.length === 0) throw new DisplayInputError("blocks must be a non-empty array");
  if (spec.blocks.length > DISPLAY_LIMITS.blocks) {
    throw new DisplayInputError(`${spec.blocks.length} blocks; max ${DISPLAY_LIMITS.blocks}`);
  }
  const types = version === 1 ? ["text", "list", "progress", "divider", "spacer"] : BLOCK_TYPES;
  spec.blocks.forEach((b, i) => {
    if (!isObj(b) || !types.includes(b.type as never)) throw new DisplayInputError(`blocks[${i}].type must be one of ${types.join(", ")}`);
  });
  if (spec.layout !== undefined && spec.layout !== "stack" && spec.layout !== "absolute") {
    throw new DisplayInputError("layout must be 'stack' or 'absolute'");
  }
  return {
    ...(version === 2 && { spec_version: DISPLAY_SPEC_VERSION }),
    blocks: spec.blocks as Record<string, unknown>[],
    ...(spec.layout === "absolute" && { layout: "absolute" as const }),
  };
}

/** A stored template, placeholders intact, with the block version it is written in. */
export function templateSpecOf(stored: unknown): { blocks: unknown[]; layout: DisplayLayout; version: 1 | 2 } {
  const s = isObj(stored) ? stored : {};
  return {
    blocks: Array.isArray(s.blocks) ? s.blocks : [],
    layout: s.layout === "absolute" ? "absolute" : "stack",
    version: s.spec_version === DISPLAY_SPEC_VERSION ? 2 : 1,
  };
}

export function templateVariables(spec: unknown): string[] {
  const found = new Set<string>();
  const walk = (v: unknown): void => {
    if (typeof v === "string") for (const m of v.matchAll(PLACEHOLDER)) found.add(m[1]);
    else if (Array.isArray(v)) v.forEach(walk);
    else if (isObj(v)) Object.values(v).forEach(walk);
  };
  walk(spec);
  return [...found].sort();
}

/** The array a whole-placeholder element stands for (`"{{v}}"` or `{label: "{{v}}"}`), else null. */
function spreadOf(item: unknown, values: Record<string, unknown>): unknown[] | null {
  const raw = typeof item === "string" ? item : isObj(item) && Object.keys(item).length === 1 && typeof item.label === "string" ? item.label : null;
  const whole = raw === null ? null : WHOLE.exec(raw);
  const value = whole ? values[whole[1]] : undefined;
  if (!Array.isArray(value)) return null;
  return typeof item === "string" ? value : value.map((label) => ({ label }));
}

export function fillTemplate(spec: unknown, data: Record<string, unknown> | undefined): unknown {
  const values = data ?? {};
  const missing = templateVariables(spec).filter((k) => values[k] === undefined || values[k] === null);
  if (missing.length) throw new DisplayInputError(`missing template data: ${missing.join(", ")}. Pass them in data.`);
  const str = (v: unknown) => (Array.isArray(v) ? v.join(", ") : String(v));
  const fill = (v: unknown): unknown => {
    if (typeof v === "string") {
      const whole = WHOLE.exec(v);
      if (whole) return values[whole[1]];
      return v.replace(PLACEHOLDER, (_, k: string) => str(values[k]));
    }
    if (Array.isArray(v)) return v.flatMap((item) => spreadOf(item, values) ?? [fill(item)]);
    if (isObj(v)) return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, fill(x)]));
    return v;
  };
  return fill(spec);
}

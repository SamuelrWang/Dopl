import { GlassesValidationError } from "../validation";
import { BLOCK_TYPES, type ScreenSpec } from "./spec";

/**
 * Saved screen templates: a {@link ScreenSpec} whose strings may hold `{{var}}`
 * placeholders. Filling is structural, not textual:
 *   - `"Build {{name}}"` → string interpolation;
 *   - a field that is EXACTLY `"{{var}}"` takes the value's own type, so
 *     `value: "{{pct}}"` becomes a number;
 *   - a list item that is exactly `"{{var}}"` with an ARRAY value is spread in.
 * A missing variable is a fixable error naming every missing name.
 */

const NAME_RE = /^[a-z0-9][a-z0-9_-]{0,63}$/;
const PLACEHOLDER = /\{\{\s*([A-Za-z0-9_]+)\s*\}\}/g;
const WHOLE = /^\{\{\s*([A-Za-z0-9_]+)\s*\}\}$/;

export function cleanTemplateName(name: unknown): string {
  const n = typeof name === "string" ? name.trim().toLowerCase() : "";
  if (!NAME_RE.test(n)) {
    throw new GlassesValidationError("name must be 1-64 chars: a-z 0-9 _ - (starting with a letter or digit)");
  }
  return n;
}

/** Structural check at save time; full layout validation happens at use time. */
export function checkTemplateSpec(spec: { blocks?: unknown; layout?: unknown }, maxBlocks: number): ScreenSpec {
  if (!Array.isArray(spec.blocks) || spec.blocks.length === 0) {
    throw new GlassesValidationError("blocks must be a non-empty array");
  }
  if (spec.blocks.length > maxBlocks) {
    throw new GlassesValidationError(`${spec.blocks.length} blocks; max ${maxBlocks}`);
  }
  spec.blocks.forEach((b, i) => {
    const type = (b as { type?: unknown } | null)?.type;
    if (!BLOCK_TYPES.includes(type as never)) {
      throw new GlassesValidationError(`blocks[${i}].type must be one of ${BLOCK_TYPES.join(", ")}`);
    }
  });
  if (spec.layout !== undefined && spec.layout !== "stack" && spec.layout !== "absolute") {
    throw new GlassesValidationError("layout must be 'stack' or 'absolute'");
  }
  return { blocks: spec.blocks as ScreenSpec["blocks"], layout: spec.layout as ScreenSpec["layout"] };
}

export function templateVariables(spec: unknown): string[] {
  const found = new Set<string>();
  const walk = (v: unknown): void => {
    if (typeof v === "string") for (const m of v.matchAll(PLACEHOLDER)) found.add(m[1]);
    else if (Array.isArray(v)) v.forEach(walk);
    else if (v && typeof v === "object") Object.values(v).forEach(walk);
  };
  walk(spec);
  return [...found].sort();
}

export function fillTemplate(spec: unknown, data: Record<string, unknown> | undefined): unknown {
  const values = data ?? {};
  const missing = templateVariables(spec).filter((k) => values[k] === undefined || values[k] === null);
  if (missing.length) {
    throw new GlassesValidationError(`missing template data: ${missing.join(", ")}. Pass them in data.`);
  }
  const str = (v: unknown) => (Array.isArray(v) ? v.join(", ") : String(v));
  const fill = (v: unknown): unknown => {
    if (typeof v === "string") {
      const whole = WHOLE.exec(v);
      if (whole) return values[whole[1]];
      return v.replace(PLACEHOLDER, (_, k: string) => str(values[k]));
    }
    if (Array.isArray(v)) {
      return v.flatMap((item) => {
        const whole = typeof item === "string" ? WHOLE.exec(item) : null;
        if (whole && Array.isArray(values[whole[1]])) return values[whole[1]] as unknown[];
        return [fill(item)];
      });
    }
    if (v && typeof v === "object") {
      return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, fill(x)]));
    }
    return v;
  };
  return fill(spec);
}

/**
 * G2 display text rules. The glasses render a narrow character set and fail
 * SILENTLY on anything else (curly quotes, long dashes, emoji), so every string
 * an agent sends is sanitized first and then measured in UTF-8 bytes — the unit
 * the firmware budgets in.
 */

export const GLASSES_LIMITS = {
  title: 64,
  body: 400,
  line: 100,
  lines: { min: 1, max: 4 },
  question: 120,
  option: 40,
  options: { min: 2, max: 4 },
} as const;

const SINGLE_QUOTES = /[‘’‚‛′]/g;
const DOUBLE_QUOTES = /[“”„‟″]/g;
const DASHES = /[‒–—―−]/g;
const ELLIPSIS = /…/g;
const NBSP = /[   ]/g;
// Non-BMP (surrogate pairs), BMP pictographs/dingbats, variation selectors,
// zero-width joiners and keycap combiners: all emoji building blocks.
const EMOJI_OR_NON_BMP =
  /[\uD800-\uDBFF][\uDC00-\uDFFF]|[\uD800-\uDFFF]|[☀-➿⬀-⯿⌀-⏿︀-️​-‍⃣]/g;

export function sanitizeGlassesText(input: string): string {
  return input
    .replace(SINGLE_QUOTES, "'")
    .replace(DOUBLE_QUOTES, '"')
    .replace(DASHES, "-")
    .replace(ELLIPSIS, "...")
    .replace(NBSP, " ")
    .replace(EMOJI_OR_NON_BMP, "")
    .replace(/[ \t]+/g, " ")
    .trim();
}

export function utf8Bytes(s: string): number {
  return new TextEncoder().encode(s).length;
}

export class GlassesValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GlassesValidationError";
  }
}

/** Sanitize, then enforce non-empty + a byte cap. `label` names the field in the error. */
export function cleanField(label: string, value: unknown, maxBytes: number): string {
  if (typeof value !== "string") {
    throw new GlassesValidationError(`${label} must be a string`);
  }
  const clean = sanitizeGlassesText(value);
  if (!clean) throw new GlassesValidationError(`${label} is empty after sanitizing`);
  const bytes = utf8Bytes(clean);
  if (bytes > maxBytes) {
    throw new GlassesValidationError(
      `${label} is ${bytes} bytes; max ${maxBytes}. Shorten it.`,
    );
  }
  return clean;
}

export function cleanList(
  label: string,
  value: unknown,
  count: { min: number; max: number },
  maxBytesEach: number,
): string[] {
  if (!Array.isArray(value)) {
    throw new GlassesValidationError(`${label} must be an array of strings`);
  }
  if (value.length < count.min || value.length > count.max) {
    throw new GlassesValidationError(
      `${label} has ${value.length} items; need ${count.min}-${count.max}`,
    );
  }
  return value.map((item, i) => cleanField(`${label}[${i}]`, item, maxBytesEach));
}

/** Integer seconds within [min, max], or the default when absent. */
export function cleanSeconds(
  label: string,
  value: unknown,
  fallback: number,
  min: number,
  max: number,
): number {
  if (value === undefined || value === null) return fallback;
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new GlassesValidationError(`${label} must be a number of seconds`);
  }
  const n = Math.round(value);
  if (n < min || n > max) {
    throw new GlassesValidationError(`${label} is ${n}; allowed ${min}-${max}`);
  }
  return n;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** A malformed id would 22P02 in Postgres; callers treat it as "not found". */
export function isUuid(s: string): boolean {
  return UUID_RE.test(s);
}

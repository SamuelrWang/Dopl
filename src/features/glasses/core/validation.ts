/**
 * Input checks for agent-supplied glasses text. Sizes are UTF-8 bytes, the unit
 * the device budgets in; text is sanitized for the target display first.
 */

/** The notify / show / ask card budgets the plugin renders. */
export const GLASSES_LIMITS = {
  title: 64,
  body: 400,
  line: 100,
  lines: { min: 1, max: 4 },
  question: 120,
  option: 40,
  options: { min: 2, max: 4 },
} as const;

export type Sanitize = (input: string) => string;

export function utf8Bytes(s: string): number {
  return new TextEncoder().encode(s).length;
}

/** Longest prefix of `s` within `max` UTF-8 bytes. */
export function clampBytes(s: string, max: number): string {
  let out = s;
  while (utf8Bytes(out) > max) out = out.slice(0, -1);
  return out;
}

export class GlassesValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GlassesValidationError";
  }
}

/** Sanitize, then enforce non-empty + a byte cap. `label` names the field in the error. */
export function cleanField(sanitize: Sanitize, label: string, value: unknown, maxBytes: number): string {
  if (typeof value !== "string") throw new GlassesValidationError(`${label} must be a string`);
  const clean = sanitize(value);
  if (!clean) throw new GlassesValidationError(`${label} is empty after sanitizing`);
  const bytes = utf8Bytes(clean);
  if (bytes > maxBytes) throw new GlassesValidationError(`${label} is ${bytes} bytes; max ${maxBytes}. Shorten it.`);
  return clean;
}

export function cleanList(
  sanitize: Sanitize,
  label: string,
  value: unknown,
  count: { min: number; max: number },
  maxBytesEach: number,
): string[] {
  if (!Array.isArray(value)) throw new GlassesValidationError(`${label} must be an array of strings`);
  if (value.length < count.min || value.length > count.max) {
    throw new GlassesValidationError(`${label} has ${value.length} items; need ${count.min}-${count.max}`);
  }
  return value.map((item, i) => cleanField(sanitize, `${label}[${i}]`, item, maxBytesEach));
}

/** Integer seconds within [min, max], or the default when absent. */
export function cleanSeconds(label: string, value: unknown, fallback: number, min: number, max: number): number {
  if (value === undefined || value === null) return fallback;
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new GlassesValidationError(`${label} must be a number of seconds`);
  }
  const n = Math.round(value);
  if (n < min || n > max) throw new GlassesValidationError(`${label} is ${n}; allowed ${min}-${max}`);
  return n;
}

/** A display name for the lens: sanitized, capped, with a fallback. */
export function cleanName(sanitize: Sanitize, s: string | null | undefined, fallback: string, max = 40): string {
  return (sanitize(s ?? "") || fallback).slice(0, max);
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** A malformed id would 22P02 in Postgres; callers treat it as "not found". */
export function isUuid(s: string): boolean {
  return UUID_RE.test(s);
}

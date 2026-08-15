import { isUuid } from "@/shared/lib/id/uuid";

/**
 * Generic slug generator. Output matches ^[a-z0-9-]+$ — safe for URLs and MCP
 * prompt names.
 *
 * - ⚠ NFKD-normalize THEN strip combining marks, so full-width/circled variants
 *   fold to their ASCII analogs and accents transliterate to a base form
 *   ("café" → "cafe", not "caf"): NFKD decomposes é into e + U+0301, and the
 *   combining-mark strip drops the U+0301.
 * - Lowercase; any non-alphanumeric run → one hyphen (implicitly stripping
 *   control chars, zero-width chars and emoji).
 * - Strip leading/trailing hyphens; fall back to `fallback` on empty.
 * - Resolve collisions against `existingSlugs` with `base-2`, `base-3`, …
 *
 * ⚠ Unicode safety: normalization + the [a-z0-9] whitelist makes output
 * deterministic and visually unambiguous — two inputs that look identical to a
 * human (or a confusable screener) produce the same slug.
 */
export function slugify(
  name: string,
  fallback: string,
  existingSlugs: string[] = []
): string {
  let base = name
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
  if (!base) base = fallback;
  // ⚠ Slug-space and id-space must stay DISJOINT: services route UUID-shaped
  // refs to the id column, so a verbatim-UUID slug makes the row unreachable by
  // its own slug.
  if (isUuid(base)) base = `${base}-x`;
  const existing = new Set(existingSlugs);
  let slug = base;
  let n = 2;
  while (existing.has(slug)) {
    slug = `${base}-${n++}`;
  }
  return slug;
}

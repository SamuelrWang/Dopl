import { isUuid } from "@/shared/lib/id/uuid";

/**
 * Generic slug generator.
 * Output matches ^[a-z0-9-]+$ so it's safe for URLs and MCP prompt names.
 *
 * - NFKD-normalizes input then strips combining marks, so visually-
 *   equivalent variants ("ｆｏｏ" full-width, "①" circled-1) produce the
 *   same slug as their ASCII analogs (audit fix S-16) AND accented
 *   letters transliterate to their base form ("café" → "cafe" instead
 *   of "caf" — audit fix for the accent-drop). NFKD decomposes é into
 *   e + U+0301; the combining-mark strip drops the U+0301.
 * - Lowercases, replaces any non-alphanumeric run with a single hyphen
 *   — implicitly strips control chars, zero-width characters, and
 *   emoji, all of which are non-alphanumeric.
 * - Strips leading/trailing hyphens.
 * - Falls back to `fallback` if the input produces an empty slug.
 * - Resolves collisions against `existingSlugs` with numeric suffixes
 *   (`base-2`, `base-3`, ...).
 *
 * Note on Unicode safety: NFKC + the [^a-z0-9] whitelist makes the
 * output deterministic and visually-unambiguous. Two inputs that look
 * identical to a human (or to a confusable-attack screening tool)
 * produce the same slug — important for /e/<slug> URLs and MCP
 * prompt names.
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
  // Slug-space and id-space must stay disjoint: services route
  // UUID-shaped refs to the id column (stable-handle acceptance), so a
  // verbatim-UUID slug would make the row unreachable by its own slug.
  if (isUuid(base)) base = `${base}-x`;
  const existing = new Set(existingSlugs);
  let slug = base;
  let n = 2;
  while (existing.has(slug)) {
    slug = `${base}-${n++}`;
  }
  return slug;
}

/**
 * Generic slug generator.
 * Output matches ^[a-z0-9-]+$ so it's safe for URLs and MCP prompt names.
 *
 * - NFKC-normalizes input so visually-equivalent variants ("ｆｏｏ" full-
 *   width, "①" circled-1) produce the same slug as their ASCII analogs
 *   instead of all collapsing to the fallback (audit fix S-16).
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
  existingSlugs: string[]
): string {
  let base = name
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
  if (!base) base = fallback;
  const existing = new Set(existingSlugs);
  let slug = base;
  let n = 2;
  while (existing.has(slug)) {
    slug = `${base}-${n++}`;
  }
  return slug;
}

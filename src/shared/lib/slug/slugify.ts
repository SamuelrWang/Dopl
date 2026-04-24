/**
 * Generic slug generator.
 * Output matches ^[a-z0-9-]+$ so it's safe for URLs and MCP prompt names.
 *
 * - Lowercases, replaces any non-alphanumeric run with a single hyphen.
 * - Strips leading/trailing hyphens.
 * - Falls back to `fallback` if the input produces an empty slug.
 * - Resolves collisions against `existingSlugs` with numeric suffixes (`base-2`, `base-3`, ...).
 */
export function slugify(
  name: string,
  fallback: string,
  existingSlugs: string[]
): string {
  let base = name
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

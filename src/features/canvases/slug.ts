/**
 * Slugify a canvas name into a URL-safe handle, deduplicating against
 * the user's existing canvas slugs. Mirrors `slugifyClusterName` in
 * `features/clusters/slug.ts` so behavior is consistent across features.
 */
export function slugifyCanvasName(name: string, existing: string[]): string {
  const base = name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 60) || "canvas";

  if (!existing.includes(base)) return base;

  let n = 2;
  while (existing.includes(`${base}-${n}`)) n++;
  return `${base}-${n}`;
}

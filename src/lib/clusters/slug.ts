/**
 * Slugify a cluster name for use in URLs and MCP prompt names.
 * Output matches ^[a-z0-9-]+$ (MCP prompt name constraint).
 */
export function slugifyClusterName(
  name: string,
  existingSlugs: string[]
): string {
  let base = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
  if (!base) base = "cluster";
  let slug = base;
  let n = 2;
  while (existingSlugs.includes(slug)) {
    slug = `${base}-${n++}`;
  }
  return slug;
}

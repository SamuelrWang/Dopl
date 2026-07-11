/**
 * Loose UUID test used to disambiguate "id or slug" references at
 * service resolution points (skills, clusters, workflows). App slugs
 * are kebab-case and can never match the 8-4-4-4-12 hex shape.
 */
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(value: string): boolean {
  return UUID_RE.test(value);
}

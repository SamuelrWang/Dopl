/** Loose UUID test disambiguating "id or slug" refs at service resolution
 *  points. App slugs are kebab-case and can never match 8-4-4-4-12 hex. */
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(value: string): boolean {
  return UUID_RE.test(value);
}

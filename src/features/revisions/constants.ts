/**
 * Shared numbers for the changelog. ⚠ In their own module because `schema.ts`
 * is CLIENT-REACHABLE and `server/service.ts` is `server-only` — a constant
 * imported from the service would drag the Supabase admin client into the
 * renderer bundle.
 */

/** Default page for a history read. ⚠ A CEILING THAT REPORTS: the page carries
 *  `nextCursor`, so a clipped read is never indistinguishable from an exhausted
 *  one (INVARIANTS §9). */
export const REVISION_PAGE_LIMIT = 50;

/** The largest page a caller may ask for. Above it the request is a 400, not a
 *  silent clamp — `schema.ts` carries the argument. */
export const REVISION_PAGE_MAX = 200;

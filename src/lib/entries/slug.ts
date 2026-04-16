import { slugify } from "@/lib/slug/slugify";

/**
 * Slugify an entry title. Falls back to "entry" if the title produces an empty slug.
 * Callers must pass the full list of existing entry slugs to resolve collisions.
 */
export function slugifyEntryTitle(
  title: string | null | undefined,
  existingSlugs: string[]
): string {
  return slugify(title ?? "", "entry", existingSlugs);
}

/**
 * Deterministic fallback slug for entries that never got a title. Uses the first
 * 8 characters of the UUID, which is guaranteed unique across the entries table
 * since entry IDs themselves are unique. Useful for backfill without a title pass.
 */
export function fallbackSlugFromId(entryId: string): string {
  return `entry-${entryId.replace(/-/g, "").slice(0, 8)}`;
}

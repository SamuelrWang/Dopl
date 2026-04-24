/**
 * Globally-unique slug generator for published clusters.
 *
 * Format: `<kebab-from-title>-<4 base36 chars>`
 *   e.g. "marketing-skills-library-a9f3"
 *
 * Why random suffix (not a DB scan)?
 *   - Old behavior (service.ts:38-42) SELECTed every published slug into
 *     memory on every publish — O(n), painful past 50k clusters.
 *   - 4 base36 chars = 36^4 ≈ 1.6M combinations. Collision risk per
 *     publish for N existing same-title bases is ~N/1.6M. Even at 10k
 *     duplicate-title rows that's <1% per attempt.
 *   - The UNIQUE constraint on published_clusters.slug remains the
 *     final backstop. publishCluster retries on 23505 with a fresh
 *     suffix, making effective collision rate effectively zero.
 *   - Bump to 6 chars (2B combinations) when we pass ~100k clusters —
 *     one-line change.
 *
 * Output matches ^[a-z0-9-]+$ (MCP prompt name constraint),
 * matching the existing slugifyClusterName contract.
 */

const SUFFIX_LENGTH = 4;

export function generatePublishedSlug(title: string): string {
  const base =
    title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "") || "cluster";
  return `${base}-${randomSuffix()}`;
}

/**
 * Standalone export so the retry path in publishCluster can refresh
 * only the suffix without re-computing the base on every attempt.
 */
export function randomSuffix(): string {
  // Math.random().toString(36).slice(2) can be short (e.g. "a" if the
  // fractional part starts with 0 after decoding). Loop until we have
  // enough entropy. Fast in practice — typically one pass.
  let s = "";
  while (s.length < SUFFIX_LENGTH) {
    s += Math.random().toString(36).slice(2);
  }
  return s.slice(0, SUFFIX_LENGTH);
}

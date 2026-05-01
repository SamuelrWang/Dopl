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
 *
 * Suffix entropy comes from crypto.randomBytes (audit fix S-9). Older
 * Math.random() was technically sufficient (slugs aren't secrets) but
 * the same pattern will get reused for workspace-slug global-uniqueness
 * (S-4) where mild guess-resistance matters more.
 */

import { randomBytes } from "node:crypto";

const SUFFIX_LENGTH = 4;
// Pool of 32 base36 digits — generates a base36-equivalent suffix from
// crypto-strong bytes via index-modulo. Avoids the leading-zero loop
// the Math.random()-based version needed.
const BASE36 = "0123456789abcdefghijklmnopqrstuvwxyz";

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
  const bytes = randomBytes(SUFFIX_LENGTH);
  let out = "";
  for (let i = 0; i < SUFFIX_LENGTH; i++) {
    out += BASE36[bytes[i] % BASE36.length];
  }
  return out;
}

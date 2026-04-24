/**
 * URL normalization for ingestion dedup.
 *
 * Single source of truth used by (a) `/api/ingest/prepare` entry-level
 * dedup, (b) the extractor's `storeSources` path, (c) the link-follower's
 * `visitedUrls` Set, and (d) link extraction from body text. Keeping
 * these in sync is load-bearing — the whole point is that a URL visited
 * in one step is recognized as "already seen" in another, even if the
 * raw string picked up a `?utm_source=...` on its way through.
 *
 * Normalization rules (must match all callers):
 *   - Lowercase hostname.
 *   - Strip known tracking query params (utm_*, ref, source, fbclid, gclid).
 *   - Strip a single trailing slash when the path isn't just "/".
 *   - Leave everything else intact — path, fragment-free URLs, etc.
 *
 * Defensive: returns the input string as-is on any URL parse failure so
 * callers don't have to wrap this in their own try/catch.
 */

const TRACKING_PARAM_PREFIXES = ["utm_", "ref", "source", "fbclid", "gclid"] as const;

export function normalizeUrl(url: string): string {
  try {
    const u = new URL(url);
    u.hostname = u.hostname.toLowerCase();
    for (const key of [...u.searchParams.keys()]) {
      if (TRACKING_PARAM_PREFIXES.some((p) => key.startsWith(p))) {
        u.searchParams.delete(key);
      }
    }
    let result = u.toString();
    if (result.endsWith("/") && u.pathname !== "/") {
      result = result.slice(0, -1);
    }
    return result;
  } catch {
    return url;
  }
}

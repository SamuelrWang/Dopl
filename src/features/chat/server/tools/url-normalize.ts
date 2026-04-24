import "server-only";

/**
 * Normalize a URL for dedup comparison. Strips tracking params
 * (utm_*, ref, source, fbclid, gclid), lowercases the host, and
 * removes a trailing slash (except for root). Matches the same
 * normalization rule used by the ingest routes.
 */
export function normalizeUrl(url: string): string {
  try {
    const u = new URL(url);
    u.hostname = u.hostname.toLowerCase();
    const trackingPrefixes = ["utm_", "ref", "source", "fbclid", "gclid"];
    for (const key of [...u.searchParams.keys()]) {
      if (trackingPrefixes.some((p) => key.startsWith(p))) {
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

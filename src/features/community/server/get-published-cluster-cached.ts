import { cache } from "react";
import { getPublishedCluster } from "./service";

/**
 * Per-request memoized fetch for a published cluster.
 *
 * Used by both `/community/[slug]/page.tsx` (metadata + render) and
 * `/community/[slug]/opengraph-image.tsx` (OG card generation).
 *
 * React's `cache()` is request-scoped — within a single request, two
 * callers share the same promise (one DB round trip). Different
 * requests start with a fresh cache, so this composes cleanly with
 * the page's `revalidate = 60` ISR behavior.
 *
 * The OG route is a separate URL from the page, so its requests get
 * their own cache. That's fine — the OG image is itself cached as a
 * static asset once rendered, so the "extra" DB fetch happens at most
 * once per revalidate window.
 */
export const getPublishedClusterCached = cache(getPublishedCluster);

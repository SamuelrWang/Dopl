import { composeSegment, parseSegment } from "@/shared/lib/url/parse-segment";

/**
 * Build the canonical URL segment for a knowledge base:
 * `{slug}-{publicId}`. Used by KB Link / router.push / redirect builders.
 */
export function knowledgeBaseSegment(kb: {
  slug: string;
  publicId: string;
}): string {
  return composeSegment(kb.slug, kb.publicId);
}

/**
 * Client twin of `resolveKbSegment` (`./server/segment.ts`): match a
 * `{kbSlug}` URL segment against an already-loaded base list, accepting the
 * canonical `{slug}-{publicId}` form first and falling back to a legacy
 * slug-only URL.
 *
 * The desktop SPA has no server hop to resolve a deep link with, and
 * `GET /api/knowledge/bases/{id}` only takes a raw UUID
 * (docs/migration-research/web-pages.md §9) — so it resolves locally against
 * the base list it already holds. Callers compare the hit against
 * `knowledgeBaseSegment(base)` to decide whether to rewrite the URL, which is
 * the client-side stand-in for the page's 301.
 */
export function findBaseBySegment<T extends { slug: string; publicId: string }>(
  bases: readonly T[],
  segment: string
): T | null {
  const parsed = parseSegment(segment);
  if (parsed) {
    const byPublicId = bases.find((b) => b.publicId === parsed.publicId);
    if (byPublicId) return byPublicId;
  }
  return bases.find((b) => b.slug === segment) ?? null;
}

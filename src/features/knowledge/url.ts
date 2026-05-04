import { composeSegment } from "@/shared/lib/url/parse-segment";

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

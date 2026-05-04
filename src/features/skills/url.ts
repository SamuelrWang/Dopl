import { composeSegment } from "@/shared/lib/url/parse-segment";

/**
 * Build the canonical URL segment for a skill: `{slug}-{publicId}`.
 */
export function skillSegment(skill: { slug: string; publicId: string }): string {
  return composeSegment(skill.slug, skill.publicId);
}

import { PUBLIC_ID_LENGTH } from "@/shared/lib/id/constants";

export interface ParsedSegment {
  slug: string;
  publicId: string;
}

const SEGMENT_REGEX = new RegExp(`^(.+)-([0-9a-z]{${PUBLIC_ID_LENGTH}})$`);

/**
 * Parse a `{slug}-{publicId}` URL segment into its parts. Returns null
 * for legacy segments that don't carry a 12-char base62 suffix.
 *
 * Greediness note: `(.+)-` is greedy, so a segment whose slug itself
 * ends in 13+ alphanumerics still parses with the LAST 12 chars as
 * publicId. The trailing-12 alphanumeric pattern is the canonical
 * shape; anything else falls through to the legacy slug-only resolver.
 */
export function parseSegment(segment: string): ParsedSegment | null {
  const match = SEGMENT_REGEX.exec(segment);
  if (!match) return null;
  return { slug: match[1], publicId: match[2] };
}

/**
 * Compose a canonical URL segment from a slug and publicId.
 */
export function composeSegment(slug: string, publicId: string): string {
  return `${slug}-${publicId}`;
}

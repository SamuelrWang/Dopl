import { PUBLIC_ID_LENGTH } from "@/shared/lib/id/constants";

export interface ParsedSegment {
  slug: string;
  publicId: string;
}

const SEGMENT_REGEX = new RegExp(`^(.+)-([0-9a-z]{${PUBLIC_ID_LENGTH}})$`);

/**
 * Parse a `{slug}-{publicId}` URL segment. Null for legacy segments with no
 * 12-char base62 suffix.
 *
 * ⚠ `(.+)-` is GREEDY, so a slug itself ending in 13+ alphanumerics still parses
 * with the LAST 12 chars as publicId. Anything not matching falls through to the
 * legacy slug-only resolver.
 */
export function parseSegment(segment: string): ParsedSegment | null {
  const match = SEGMENT_REGEX.exec(segment);
  if (!match) return null;
  return { slug: match[1], publicId: match[2] };
}

/** Compose a canonical URL segment from a slug and publicId. */
export function composeSegment(slug: string, publicId: string): string {
  return `${slug}-${publicId}`;
}

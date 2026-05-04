import { composeSegment } from "@/shared/lib/url/parse-segment";

/**
 * Build the canonical URL segment for a workspace: `{slug}-{publicId}`.
 * Used by every Link / router.push / redirect that targets a workspace.
 */
export function workspaceSegment(ws: { slug: string; publicId: string }): string {
  return composeSegment(ws.slug, ws.publicId);
}

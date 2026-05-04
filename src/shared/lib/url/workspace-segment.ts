import { RESERVED_WORKSPACE_SLUGS } from "@/config";

/**
 * Pull the workspace handle out of the first path segment. Returns
 * the canonical `{slug}-{publicId}` segment, or — for legacy URLs
 * before the publicId migration — the bare slug. Null for top-level
 * static routes (`/login`, `/settings`, `/browse`, ...) and the
 * legacy `/canvas`.
 *
 * Shared between the layout shell (which provides the my-access
 * context) and the sidebar (which renders nav rows scoped to the
 * active workspace) so they always agree on what "the current
 * workspace" is.
 */
export function workspaceSegmentFromPath(pathname: string): string | null {
  const segments = pathname.split("/").filter(Boolean);
  if (segments.length === 0) return null;
  const first = segments[0];
  if (RESERVED_WORKSPACE_SLUGS.has(first)) return null;
  return first;
}

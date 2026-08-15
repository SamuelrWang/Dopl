import { composeSegment } from "@/shared/lib/url/parse-segment";

/**
 * Canonical URL segment for a workspace: `{slug}-{publicId}`. Used by every
 * Link / router.push / redirect that targets a workspace.
 */
export function workspaceSegment(ws: { slug: string; publicId: string }): string {
  return composeSegment(ws.slug, ws.publicId);
}

/** Desktop protocol scheme. ⚠ Must match `PROTOCOL` in `dopl-desktop-app/main/config.js`. */
const DESKTOP_SCHEME = "dopl";

/**
 * THE HANDOFF LINK — `dopl://open/{segment}`, the one URL the retired website
 * has that lands somebody inside the product. The web tree can no longer render
 * a workspace (Stage D deleted `src/app/[workspaceSlug]/**`;
 * `/{slug}-{publicId}` 302s to `/get-started`).
 *
 * ⚠ PATH form of the grammar; the desktop side reads it with the same map as a
 * web bookmark (`main/deep-link-target.js › webPathToRoute`) — a bare workspace
 * segment resolves to `/{segment}/overview`. `join` and `invite` stay in
 * `WEB_ONLY_ROOTS`: what crosses is the WORKSPACE, never the invite URL.
 *
 * A workspace missing either half of its segment yields the bare `dopl://open`
 * verb rather than a malformed path (the server answers `""` for a workspace it
 * could not read back — `join-links.ts › requestJoin`).
 */
export function workspaceDeepLink(ws: { slug: string; publicId: string }): string {
  if (!ws.slug || !ws.publicId) return `${DESKTOP_SCHEME}://open`;
  return `${DESKTOP_SCHEME}://open/${workspaceSegment(ws)}`;
}

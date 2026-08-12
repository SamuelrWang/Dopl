import { composeSegment } from "@/shared/lib/url/parse-segment";

/**
 * Build the canonical URL segment for a workspace: `{slug}-{publicId}`.
 * Used by every Link / router.push / redirect that targets a workspace.
 */
export function workspaceSegment(ws: { slug: string; publicId: string }): string {
  return composeSegment(ws.slug, ws.publicId);
}

/** The desktop app's protocol scheme. `PROTOCOL` in `dopl-desktop-app/main/config.js`. */
const DESKTOP_SCHEME = "dopl";

/**
 * THE HANDOFF LINK — `dopl://open/{segment}`, the one URL the retired website
 * has that lands somebody inside the product.
 *
 * The web tree can no longer render a workspace (Stage D deleted
 * `src/app/[workspaceSlug]/**`, and `/{slug}-{publicId}` now 302s to
 * `/get-started`), so every "you're in, go to the workspace" moment is a
 * handoff to the desktop app rather than a `router.push`.
 *
 * `dopl://open/{segment}` is the grammar's PATH form, and the desktop side
 * reads that path with the same map it reads a web bookmark with
 * (`main/deep-link-target.js › webPathToRoute`): a bare workspace segment
 * resolves to `/{segment}/overview`, the workspace index. Nothing new is asked
 * of the desktop grammar — `join` and `invite` stay in `WEB_ONLY_ROOTS`,
 * because what crosses is the WORKSPACE, never the invite URL.
 *
 * A workspace missing either half of its segment yields the bare `dopl://open`
 * verb instead of a malformed path. The server answers `""` for a workspace it
 * could not read back (`join-links.ts › requestJoin`), and `/{-publicId}` would
 * be refused by the segment check on the other side and open home anyway —
 * this just says so deliberately, and still opens the app.
 */
export function workspaceDeepLink(ws: { slug: string; publicId: string }): string {
  if (!ws.slug || !ws.publicId) return `${DESKTOP_SCHEME}://open`;
  return `${DESKTOP_SCHEME}://open/${workspaceSegment(ws)}`;
}

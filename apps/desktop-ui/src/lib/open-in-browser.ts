import { openExternalPath, openExternalUrl } from "@/shared/lib/open-external";

/**
 * Handing a URL off to the user's real browser, for this renderer.
 *
 * Both functions are thin fire-and-forget wrappers over
 * `@/shared/lib/open-external` — the shared bridge-or-`window.open` helper the
 * web tree uses too, so there is exactly one place that decides how an
 * external link leaves the app.
 *
 * Lives in `lib/` rather than under `components/settings-modal/`: the boot
 * screen's public-page links need it as much as billing does, and burying it
 * under a feature folder is why the signed-out screen grew its own copy.
 */

/** Hand an absolute URL off to the user's real browser. For URLs this app did
 *  not build — the Stripe-hosted billing portal, which the API mints. */
export function openUrlInBrowser(url: string): void {
  void openExternalUrl(url);
}

/** Hand an app path off to the user's real browser (origin from the preload
 *  constant — the packaged renderer is a `file://` document). */
export function openInBrowser(path: string): void {
  void openExternalPath(path);
}

/**
 * The web app's billing surface for a specific workspace: the (app) layout
 * mounts the settings modal and its effect opens Plans & Billing whenever a
 * `billing` query param is present (`src/shared/layout/app-shell/app-shell.tsx`
 * — the same param Stripe's return URLs carry). Workspace-scoped on purpose:
 * the bare `/canvas?billing=…` redirect resolves the user's DEFAULT workspace,
 * which is not necessarily the one open here.
 */
export function billingPath(workspaceSegment: string): string {
  return `/${workspaceSegment}/canvas?billing=upgrade`;
}

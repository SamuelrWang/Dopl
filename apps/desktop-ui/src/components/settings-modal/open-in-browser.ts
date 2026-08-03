import { getAppOrigin } from "@/shared/lib/app-origin";
import { getBridge } from "#/lib/dopl-bridge";

/**
 * Hand a path off to the user's real browser.
 *
 * The origin comes from `getAppOrigin()` (the preload constant), never from
 * `window.location` — the packaged renderer is a `file://` document, where a
 * relative URL builds `file:///…`. Without a bridge (browser dev mode) the
 * "external" browser is this one.
 */
export function openInBrowser(path: string): void {
  const url = `${getAppOrigin()}${path}`;
  const bridge = getBridge();
  if (bridge) {
    void bridge.openExternal(url);
    return;
  }
  window.open(url, "_blank", "noopener,noreferrer");
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

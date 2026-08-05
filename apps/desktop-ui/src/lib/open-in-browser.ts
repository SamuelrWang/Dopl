import {
  billingPath as webBillingPath,
  type CheckoutPlan,
} from "@/features/billing/url";
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
 * The web billing surface for a specific workspace — `/billing/{segment}`,
 * THE POST-RETIREMENT BILLING PAGE (`src/app/billing/[segment]/page.tsx`).
 *
 * It used to be `/{segment}/canvas?billing=upgrade`, which mounted the whole
 * app shell to open a settings modal; that tree is being deleted
 * (docs/migration-research/website-retirement-plan.md), and this handoff is one
 * of the two flows that tethered the desktop app to it. Built by the web tree's
 * one billing-URL module so this and Stripe's return URLs cannot drift apart.
 *
 * Workspace-scoped on purpose: a segment-less `/billing` resolves the user's
 * DEFAULT workspace, which is not necessarily the one open here. `plan` is
 * passed when the user already chose one, so the browser opens straight into
 * that checkout instead of asking the same question twice.
 */
export function billingPath(
  workspaceSegment: string,
  plan?: CheckoutPlan
): string {
  return webBillingPath({ segment: workspaceSegment, intent: "upgrade", plan });
}

/**
 * The same page with no intent — where account DELETION lives. Deletion is
 * irreversible and runs a Supabase sign-out + redirect the renderer cannot
 * reproduce, so it stays on the web (plan decision D4) and the desktop Account
 * pane links here (`../components/settings-modal/account-actions.tsx`).
 */
export function accountPagePath(workspaceSegment: string): string {
  return webBillingPath({ segment: workspaceSegment });
}

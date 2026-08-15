import {
  billingPath as webBillingPath,
  type CheckoutPlan,
} from "@/features/billing/url";
import { openExternalPath, openExternalUrl } from "@/shared/lib/open-external";

/**
 * Handing a URL off to the user's real browser. Thin fire-and-forget wrappers
 * over `@/shared/lib/open-external` — the shared bridge-or-`window.open`
 * helper the web tree uses, so ONE place decides how a link leaves the app.
 *
 * ⚠ Stays in `lib/`, not under `components/settings-modal/`: the boot screen's
 * public-page links need it too, and burying it under a feature folder is how
 * the signed-out screen grew its own copy.
 */

/** For URLs this app did not build — e.g. the API-minted Stripe portal url. */
export function openUrlInBrowser(url: string): void {
  void openExternalUrl(url);
}

/** App path → browser. Origin comes from the preload constant; the packaged
 *  renderer is a `file://` document. */
export function openInBrowser(path: string): void {
  void openExternalPath(path);
}

/**
 * Web billing surface for a workspace — `/billing/{segment}`
 * (`src/app/billing/[segment]/page.tsx`). ⚠ Built by the web tree's one
 * billing-URL module so this and Stripe's return URLs cannot drift apart.
 *
 * ⚠ Workspace-scoped on purpose: a segment-less `/billing` resolves the user's
 * DEFAULT workspace, not necessarily the one open here. Pass `plan` when the
 * user already chose one so the browser opens straight into that checkout.
 */
export function billingPath(
  workspaceSegment: string,
  plan?: CheckoutPlan
): string {
  return webBillingPath({ segment: workspaceSegment, intent: "upgrade", plan });
}

/**
 * Same page, no intent — where account DELETION lives. Irreversible, and its
 * Supabase sign-out + redirect is not reproducible in the renderer, so it stays
 * on the web; `../components/settings-modal/account-actions.tsx` links here.
 */
export function accountPagePath(workspaceSegment: string): string {
  return webBillingPath({ segment: workspaceSegment });
}

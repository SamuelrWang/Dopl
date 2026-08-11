/**
 * `/billing/{workspaceSegment}` — the money page, and a KEEP page.
 *
 * THE ONE PRODUCT-SHAPED WEB PAGE THAT SURVIVES THE RETIREMENT. Everything
 * under `src/app/[workspaceSlug]/(app)/` is replaced by the desktop SPA
 * (docs/migration-research/website-retirement-plan.md); billing cannot follow it
 * because checkout is `ui_mode: "elements"` — our own React payment form, which
 * the packaged renderer's CSP (`script-src 'self'`, `connect-src 'none'`) can
 * never mount. Decision D1(a): one small page, assembled from the shipped
 * settings-modal sections, importing none of the app shell. Every billing URL in
 * the product now points here (`src/features/billing/url.ts`).
 *
 * AUTH-REQUIRED, TWICE, EXACTLY LIKE `/get-started`. `/billing` is deliberately
 * absent from `proxy.ts` PUBLIC_ROUTES, so a signed-out visitor is bounced to
 * `/login?redirectTo=…` and returns here; the `getUser()` below is the second
 * lock, because the middleware decides from LOCALLY verified claims and this
 * decides from GoTrue, and where they disagree the stricter one wins. The
 * `redirectTo` carries the QUERY, not just the path — a first-time payer's
 * browser is by definition signed out, and dropping `?billing=upgrade` across
 * the sign-in is how checkout silently fails to open (see `src/proxy.ts`, which
 * had the same bug on its own bounce).
 *
 * SEGMENT RESOLUTION IS THE APP TREE'S, UNCHANGED. Same
 * `resolveWorkspaceSegmentForUser` the `(app)` layout uses: membership-scoped,
 * so a workspace the caller cannot reach 404s exactly like one that does not
 * exist (no existence leak), legacy slug-only URLs still resolve, and a stale
 * segment redirects to the canonical one with the query intact.
 */

import { notFound, redirect } from "next/navigation";
import { BillingPageScreen } from "@/features/billing/components/billing-page-screen";
import { resolveBillingTab } from "@/features/billing/billing-tabs";
import {
  billingSelfPath,
  parseBillingIntent,
  parseBillingReturn,
  parseCheckoutPlan,
} from "@/features/billing/url";
import { resolveWorkspaceSegmentForUser } from "@/features/workspaces/server/segment";
import { resolveMembershipOrThrow } from "@/features/workspaces/server/service";
import { workspaceSegment } from "@/features/workspaces/url";
import { getUser } from "@/shared/supabase/server";

export const metadata = {
  title: "Billing — Dopl",
  description: "Manage your Dopl plan, payment method and account.",
};

/** Entitlements and membership are per-request facts; a cached render would
 *  show a just-upgraded workspace its old plan. */
export const dynamic = "force-dynamic";

interface PageProps {
  params: Promise<{ segment: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

export default async function BillingPage({ params, searchParams }: PageProps) {
  const { segment } = await params;
  const query = await searchParams;

  const user = await getUser();
  if (!user) {
    redirect(
      `/login?redirectTo=${encodeURIComponent(billingSelfPath(segment, query))}`
    );
  }

  const resolved = await resolveWorkspaceSegmentForUser(segment, user.id);
  // Not a workspace, or not one this user is a member of — the same answer for
  // both, so the page cannot be used to probe which workspaces exist.
  if (!resolved) notFound();

  const workspace = resolved.workspace;
  if (resolved.needsRedirect) {
    redirect(billingSelfPath(workspaceSegment(workspace), query));
  }

  const { membership } = await resolveMembershipOrThrow(workspace.id, user.id);

  const billingParam = typeof query.billing === "string" ? query.billing : null;
  const planParam = typeof query.plan === "string" ? query.plan : null;
  const tabParam = typeof query.tab === "string" ? query.tab : null;

  return (
    <BillingPageScreen
      workspaceName={workspace.name}
      workspaceId={workspace.id}
      role={membership.role}
      billingReturn={parseBillingReturn(billingParam)}
      // Only an explicit "sell me this plan" arrival opens checkout on mount;
      // a bare `?billing=upgrade` (the 402 envelopes, which know no plan) lands
      // on the plan list, which is the question they were asking anyway.
      initialCheckoutPlan={
        parseBillingIntent(billingParam) === "upgrade"
          ? parseCheckoutPlan(planParam)
          : null
      }
      // `?tab=` wins when it names a tab; otherwise ANY recognised `?billing=`
      // intent (upgrade / success / return) opens on Billing, because all three
      // arrive mid-transaction. A bare visit opens on Usage.
      initialTab={resolveBillingTab(
        tabParam,
        parseBillingIntent(billingParam) !== null
      )}
    />
  );
}

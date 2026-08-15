/**
 * `/billing/{workspaceSegment}` — the money page, and the one product-shaped web page that
 * survives the retirement. Billing cannot move to the desktop SPA because checkout is
 * `ui_mode: "elements"` — our own React payment form, which the packaged renderer's CSP
 * (`script-src 'self'`, `connect-src 'none'`) can never mount. Assembled from the shipped
 * settings-modal sections; imports none of the app shell. Every billing URL points here
 * (`src/features/billing/url.ts`).
 *
 * ⚠ AUTH-REQUIRED TWICE. `/billing` is deliberately absent from `proxy.ts` PUBLIC_ROUTES; the
 * `getUser()` below is the second lock, because the middleware decides from LOCALLY verified
 * claims and this from GoTrue — the stricter wins.
 * ⚠ `redirectTo` carries the QUERY, not just the path: a first-time payer is by definition signed
 * out, and dropping `?billing=upgrade` across sign-in is how checkout silently fails to open.
 *
 * Segment resolution is the app tree's `resolveWorkspaceSegmentForUser`: membership-scoped (an
 * unreachable workspace 404s like a nonexistent one), legacy slug-only URLs resolve, a stale
 * segment redirects to canonical with the query intact.
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

/** Per-request facts: a cached render shows a just-upgraded workspace its old plan. */
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
  // Same answer for "not a workspace" and "not a member" — no existence oracle.
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
      // Only an explicit plan opens checkout on mount; bare `?billing=upgrade` (the 402
      // envelopes, which know no plan) lands on the plan list.
      initialCheckoutPlan={
        parseBillingIntent(billingParam) === "upgrade"
          ? parseCheckoutPlan(planParam)
          : null
      }
      // ⚠ Any `?billing=` intent outranks `?tab=`: all three arrive mid-transaction and only
      // the Billing pane runs the post-payment poll. Otherwise `?tab=`; bare visit → Usage.
      initialTab={resolveBillingTab(
        tabParam,
        parseBillingIntent(billingParam) !== null
      )}
    />
  );
}

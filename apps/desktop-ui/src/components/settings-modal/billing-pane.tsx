import { useState } from "react";
import { apiRequest } from "@/shared/api/api-client";
import type { Role } from "@/features/workspaces/types";
import { PlansBillingCore } from "@/shared/layout/settings-modal/sections/plans-billing-core";
import { billingPath, openInBrowser, openUrlInBrowser } from "#/lib/open-in-browser";

interface Props {
  workspaceSegment: string;
  workspaceId: string;
  role: Role;
}

/**
 * Plans & Billing — the DESKTOP binding of `PlansBillingCore`. Renders in
 * full — the same two cards the core picks for the container it was handed
 * (`plans.ts › plansForKind`, 2026-09-08): a STANDARD workspace gets Starter
 * (free, 100 credits per member per month) and Team ($8.99 per seat, 5,000 per
 * member) plus the legacy-Pro note; a `kind='personal'` container gets Free
 * (500 credits a month) and **Pro** ($8.99 a month, 5,000). The copy lives in
 * the shared core and this file adds no words of its own about plans. Only the
 * two Stripe-shaped actions differ, because the packaged CSP
 * (`script-src 'self'`, `connect-src 'none'`) refuses Stripe and all origins:
 *
 *   - Upgrade/checkout — web mounts Embedded Checkout in-pane; here it opens
 *     the same workspace's web billing surface in the browser.
 *   - Manage billing — already a redirect to a Stripe-HOSTED url the API mints,
 *     so fetch that url over the bridge and open it externally rather than
 *     navigating this document. Free workspaces have no Stripe customer and the
 *     route 4xxs → falls back to the web surface.
 */
export function BillingPane({ workspaceSegment, workspaceId, role }: Props) {
  const [portalLoading, setPortalLoading] = useState(false);
  const [portalError, setPortalError] = useState<string | null>(null);

  async function handleManage() {
    setPortalLoading(true);
    setPortalError(null);
    try {
      const data = await apiRequest<{ url?: string }>("/api/billing/portal", {
        method: "POST",
        workspaceId,
      });
      if (!data?.url) throw new Error("Couldn't open billing portal");
      openUrlInBrowser(data.url);
    } catch {
      // No portal session (or call failed): hand the surface to the browser
      // rather than dead-ending on an error line.
      openInBrowser(billingPath(workspaceSegment));
      setPortalError("Opening billing in your browser…");
    } finally {
      setPortalLoading(false);
    }
  }

  return (
    <div>
      <PlansBillingCore
        role={role}
        workspaceId={workspaceId}
        // The chosen plan rides to the browser, so the billing page opens on
        // that checkout instead of re-asking (`features/billing/url.ts`). ⚠ The
        // plan is `team` OR `pro` since 2026-09-08 and `billingPath` already
        // takes the union — the segment is whichever container's settings are
        // open, which is the container the core offered that plan for.
        onUpgrade={(plan) => openInBrowser(billingPath(workspaceSegment, plan))}
        onManage={handleManage}
        portalLoading={portalLoading}
        portalError={portalError}
      />
      <p className="mt-4 text-caption text-text-secondary">
        Payment steps finish in your browser — the desktop app never handles
        card details. Your plan updates here as soon as they do.
      </p>
    </div>
  );
}

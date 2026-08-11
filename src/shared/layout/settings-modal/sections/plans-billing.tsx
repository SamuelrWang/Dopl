"use client";

import { useState } from "react";
import {
  formatMoney,
  SOLO_PRICE,
  TEAM_SEAT_PRICE,
  useWorkspaceEntitlements,
} from "@/features/billing/components/use-workspace-entitlements";
import { EmbeddedCheckoutForm } from "@/features/billing/components/embedded-checkout";
import { useBillingPortal } from "@/features/billing/components/use-billing-portal";
import type { Role } from "@/features/workspaces/types";
import { PlansBillingCore, type CheckoutPlan } from "./plans-billing-core";
import styles from "../settings-modal.module.css";

/**
 * Plans & Billing — the WEB binding.
 *
 * The pane lives in `./plans-billing-core`, which is Stripe-free; this file
 * adds the two things only a browser document can do: swap the pane for
 * Stripe's embedded checkout in place, and redirect this tab to the
 * Stripe-hosted billing portal. Both handlers are unchanged from when they
 * lived alongside the markup.
 */
export function PlansBilling({
  billingReturn = null,
  initialCheckoutPlan = null,
  role,
  workspaceId,
}: {
  billingReturn?: "success" | "return" | null;
  /**
   * Open checkout on this plan at mount instead of on a click. Set by the
   * `/billing/[segment]` page from `?billing=upgrade&plan=…`, so a desktop
   * user who already chose Pro or Team in the app is not asked again in the
   * browser (`src/features/billing/url.ts`). Null everywhere else — the
   * settings modal opens on the plan list, unchanged.
   */
  initialCheckoutPlan?: CheckoutPlan | null;
  role: Role;
  workspaceId?: string;
}) {
  // Same args as the core's read → one cache entry, one request.
  const ent = useWorkspaceEntitlements(workspaceId);
  const [checkoutPlan, setCheckoutPlan] = useState<CheckoutPlan | null>(
    initialCheckoutPlan
  );
  // The portal POST + redirect moved to `useBillingPortal` when the billing
  // page's payment-method card needed the identical handoff; the behaviour is
  // unchanged.
  const portal = useBillingPortal(workspaceId);

  if (checkoutPlan && !ent.isPaid) {
    return (
      <div>
        <button
          type="button"
          className="mb-4 cursor-pointer text-small text-text-secondary transition-colors hover:text-text-primary"
          onClick={() => setCheckoutPlan(null)}
        >
          ← Back to plans
        </button>
        <h2 className={styles.paneTitle}>
          {checkoutPlan === "solo" ? "Subscribe to Pro" : "Subscribe to Team"}
        </h2>
        <p className="mb-4 text-caption text-text-secondary">
          {checkoutPlan === "solo"
            ? `${formatMoney(SOLO_PRICE)} / month — flat, single member`
            : `${ent.billableSeats} ${ent.billableSeats === 1 ? "seat" : "seats"} · ${formatMoney(
                ent.billableSeats * TEAM_SEAT_PRICE
              )} / month`}
        </p>
        <EmbeddedCheckoutForm workspaceId={workspaceId} plan={checkoutPlan} />
      </div>
    );
  }

  return (
    <PlansBillingCore
      billingReturn={billingReturn}
      role={role}
      workspaceId={workspaceId}
      onUpgrade={setCheckoutPlan}
      onManage={portal.open}
      portalLoading={portal.loading}
      portalError={portal.error}
    />
  );
}

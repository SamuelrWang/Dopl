"use client";

import { useEffect, useState } from "react";
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
 * Plans & Billing — WEB binding. The pane lives in the Stripe-free
 * `./plans-billing-core`; this file adds the two browser-only moves: swap the
 * pane for Stripe embedded checkout in place, and redirect this tab to the
 * Stripe-hosted portal.
 */
export function PlansBilling({
  billingReturn = null,
  initialCheckoutPlan = null,
  onCheckoutOpenChange,
  role,
  workspaceId,
}: {
  billingReturn?: "success" | "return" | null;
  /** Opens checkout on this plan at mount instead of on a click. Set by
   *  `/billing/[segment]` from `?billing=upgrade&plan=…`
   *  (`features/billing/url.ts`); null everywhere else. */
  initialCheckoutPlan?: CheckoutPlan | null;
  /**
   * Whether the embedded checkout form is CURRENTLY MOUNTED.
   * ⚠ A host that can unmount this pane (the `/billing/[segment]` tab shell, on
   * a tab click) must know: Stripe's form holds card entry living only in this
   * tree, and unmounting silently discards it and its session.
   * Must be referentially stable (a `useState` setter is).
   */
  onCheckoutOpenChange?: (open: boolean) => void;
  role: Role;
  workspaceId?: string;
}) {
  // Same args as the core's read → one cache entry, one request.
  const ent = useWorkspaceEntitlements(workspaceId);
  const [checkoutPlan, setCheckoutPlan] = useState<CheckoutPlan | null>(
    initialCheckoutPlan
  );
  const portal = useBillingPortal(workspaceId);

  // ⚠ Must stay the exact condition the checkout branch below renders on, or the
  // signal drifts from what is actually mounted.
  const checkoutOpen = Boolean(checkoutPlan) && !ent.isPaid;
  useEffect(() => {
    onCheckoutOpenChange?.(checkoutOpen);
    // Unmounting this pane unmounts the form — don't leave the host holding a
    // stale "checkout is open".
    return () => onCheckoutOpenChange?.(false);
  }, [checkoutOpen, onCheckoutOpenChange]);

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

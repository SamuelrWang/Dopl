"use client";

import { useState } from "react";
import {
  formatMoney,
  SOLO_PRICE,
  TEAM_SEAT_PRICE,
  useWorkspaceEntitlements,
} from "@/features/billing/components/use-workspace-entitlements";
import { EmbeddedCheckoutForm } from "@/features/billing/components/embedded-checkout";
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
  role,
  workspaceId,
}: {
  billingReturn?: "success" | "return" | null;
  role: Role;
  workspaceId?: string;
}) {
  // Same args as the core's read → one cache entry, one request.
  const ent = useWorkspaceEntitlements(workspaceId);
  const [checkoutPlan, setCheckoutPlan] = useState<CheckoutPlan | null>(null);
  const [portalLoading, setPortalLoading] = useState(false);
  const [portalError, setPortalError] = useState<string | null>(null);

  async function handleManage() {
    setPortalLoading(true);
    setPortalError(null);
    try {
      const res = await fetch("/api/billing/portal", {
        method: "POST",
        headers: workspaceId ? { "x-workspace-id": workspaceId } : undefined,
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.url) {
        // Portal route errors are flat strings; wrapper-layer errors
        // (withWorkspaceAuth) are the nested { error: { message } } shape.
        const message =
          typeof data.error === "string"
            ? data.error
            : typeof data.error?.message === "string"
              ? data.error.message
              : "Couldn't open billing portal";
        throw new Error(message);
      }
      window.location.href = data.url;
    } catch (err) {
      setPortalError(err instanceof Error ? err.message : "Couldn't open billing portal");
    } finally {
      setPortalLoading(false);
    }
  }

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
      onManage={handleManage}
      portalLoading={portalLoading}
      portalError={portalError}
    />
  );
}

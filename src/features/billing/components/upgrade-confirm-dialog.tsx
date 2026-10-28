"use client";

import { useState } from "react";
import { ConfirmDialog } from "@/shared/ui/confirm-dialog";
import { PERSONAL_MONTHLY_CREDITS } from "../credits";
import { PERSONAL_PLAN_NAMES, planNumber, type PersonalPaidPlan } from "../plans";
import type { PersonalPlanChange, UpgradePreview } from "./use-personal-plan-change";

/**
 * The confirm step before an IN-PLACE upgrade charges a card (2026-10-22
 * review: it was one click). The amount is Stripe's own preview of the exact
 * update (`GET /api/billing/change-plan/preview`), so the dialog says what will
 * actually be charged, and that it is charged NOW. No preview, no dialog: the
 * error line says the price couldn't be loaded rather than asking the payer to
 * agree to an unknown amount.
 */

/** `$16.01` — Stripe minor units, in the invoice's own currency. */
export function formatMinorUnits(amount: number, currency: string): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: currency.toUpperCase(),
  }).format(amount / 100);
}

export function upgradeConfirmCopy(plan: PersonalPaidPlan, preview: UpgradePreview): string {
  return (
    `You'll be charged ${formatMinorUnits(preview.amountDue, preview.currency)} now — ` +
    `a full month of ${PERSONAL_PLAN_NAMES[plan]}, less what's left of your current plan.\n` +
    `${PERSONAL_PLAN_NAMES[plan]} starts today with ${planNumber(PERSONAL_MONTHLY_CREDITS[plan])} ` +
    `credits, and your billing date moves to today.`
  );
}

/**
 * `request(plan)` loads the preview and opens the dialog; `dialog` renders it.
 * The confirm button runs the switch (`change`), which owns 3-D Secure.
 */
export function useUpgradeConfirm(change: PersonalPlanChange, onDone?: () => void) {
  const [offer, setOffer] = useState<{ plan: PersonalPaidPlan; preview: UpgradePreview } | null>(
    null
  );
  const [loading, setLoading] = useState(false);

  async function request(plan: PersonalPaidPlan) {
    setLoading(true);
    try {
      const preview = await change.preview(plan);
      if (preview) setOffer({ plan, preview });
    } finally {
      setLoading(false);
    }
  }

  const dialog = (
    <ConfirmDialog
      open={offer !== null}
      onOpenChange={(open) => {
        if (!open) setOffer(null);
      }}
      title={offer ? `Upgrade to ${PERSONAL_PLAN_NAMES[offer.plan]}?` : "Upgrade"}
      description={offer ? upgradeConfirmCopy(offer.plan, offer.preview) : undefined}
      confirmLabel={
        offer
          ? `Pay ${formatMinorUnits(offer.preview.amountDue, offer.preview.currency)}`
          : "Confirm"
      }
      onConfirm={async () => {
        if (!offer) return;
        if (await change.change(offer.plan)) onDone?.();
      }}
    />
  );

  return { request, loading, dialog };
}

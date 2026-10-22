"use client";

import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/shared/api/api-client";
import { apiPathKey } from "@/shared/api/query-keys";
import { userFacingMessage } from "@/shared/api/user-facing-message";
import { useApiQuery } from "@/shared/hooks/use-api-query";
import { getSpaBridge, isSpaRenderer } from "@/shared/lib/spa-bridge";
import type { PersonalPaidPlan } from "../plans";
import { BILLING_STATUS_PATH } from "./use-workspace-entitlements";

/**
 * Client half of `/api/billing/change-plan` — switching a LIVE home space
 * subscription between Pro and Max (2026-10-22). The rules live server-side
 * (`server/plan-change.ts`); this hook reads the queued change, PREVIEWS what an
 * upgrade charges today (for the confirm dialog), fires the switch, and finishes
 * a 3-D Secure step:
 *   • web — Stripe.js `confirmCardPayment` on the invoice's PaymentIntent, then
 *     the same POST again, which finalizes (`plan-change.ts › applyChange`'s
 *     "unchanged" arm);
 *   • desktop — the packaged CSP refuses Stripe.js, so the hosted invoice opens
 *     in the browser and the plan updates by webhook when it is paid.
 */

export const BILLING_CHANGE_PLAN_PATH = "/api/billing/change-plan";
export const BILLING_CHANGE_PLAN_PREVIEW_PATH = "/api/billing/change-plan/preview";

export interface PlanChangeStateDto {
  plan: PersonalPaidPlan | null;
  scheduledPlan: PersonalPaidPlan | null;
  effectiveAt: string | null;
}

export interface UpgradePreview {
  /** Minor units (cents). */
  amountDue: number;
  currency: string;
}

interface ChangeResponse extends PlanChangeStateDto {
  outcome: string;
  payment?: { clientSecret: string | null; hostedInvoiceUrl: string | null };
}

const NOTHING_QUEUED: PlanChangeStateDto = {
  plan: null,
  scheduledPlan: null,
  effectiveAt: null,
};

/** Stripe.js is loaded lazily and only on web — the module pulls the script. */
async function confirmOnWeb(clientSecret: string): Promise<string | null> {
  const { getStripePromise } = await import("./embedded-checkout");
  const stripe = await getStripePromise();
  if (!stripe) return "Couldn't load the payment form — please try again.";
  const result = await stripe.confirmCardPayment(clientSecret);
  return result.error ? result.error.message ?? "The payment wasn't confirmed." : null;
}

export function usePersonalPlanChange(
  workspaceId: string | undefined,
  enabled: boolean
) {
  const client = useQueryClient();
  const query = useApiQuery<PlanChangeStateDto>(BILLING_CHANGE_PLAN_PATH, {
    workspaceId,
    enabled,
  });
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  // Field-wise: the query cache is persisted (INVARIANTS §8), so a replayed or
  // partial body must not crash the pane.
  const raw = enabled ? query.data : undefined;
  const state: PlanChangeStateDto = {
    plan: raw?.plan ?? null,
    scheduledPlan: raw?.scheduledPlan ?? null,
    effectiveAt: raw?.effectiveAt ?? null,
  };

  async function preview(plan: PersonalPaidPlan): Promise<UpgradePreview | null> {
    setError(null);
    try {
      return await apiRequest<UpgradePreview>(BILLING_CHANGE_PLAN_PREVIEW_PATH, {
        workspaceId,
        query: { plan },
      });
    } catch (err) {
      setError(userFacingMessage(err, "Couldn't load the price — please try again."));
      return null;
    }
  }

  const post = (plan: PersonalPaidPlan) =>
    apiRequest<ChangeResponse>(BILLING_CHANGE_PLAN_PATH, {
      method: "POST",
      workspaceId,
      body: { plan },
    });

  async function change(plan: PersonalPaidPlan): Promise<boolean> {
    setPending(true);
    setError(null);
    setNotice(null);
    try {
      const res = await post(plan);
      if (res?.outcome !== "requires_action") return true;
      const secret = res.payment?.clientSecret ?? null;
      const hosted = res.payment?.hostedInvoiceUrl ?? null;
      if (isSpaRenderer() || !secret) {
        if (hosted) void getSpaBridge()?.openExternal(hosted);
        if (hosted && !isSpaRenderer()) window.open(hosted, "_blank", "noopener");
        setNotice("Your bank needs to confirm this payment — finish it in your browser. Your plan updates when it's paid.");
        return false;
      }
      const failed = await confirmOnWeb(secret);
      if (failed) {
        setError(failed);
        return false;
      }
      await post(plan); // finalize: stamps the plan once Stripe applied the update
      return true;
    } catch (err) {
      setError(userFacingMessage(err, "Couldn't change your plan — please try again."));
      return false;
    } finally {
      // Both paths: a refused switch may still mean the row moved (another tab).
      // `pending` covers the refetch so the buttons cannot fire a second POST
      // against a stale plan.
      await Promise.all([
        client.invalidateQueries({ queryKey: apiPathKey(BILLING_STATUS_PATH) }),
        client.invalidateQueries({ queryKey: apiPathKey(BILLING_CHANGE_PLAN_PATH) }),
      ]);
      setPending(false);
    }
  }

  return {
    ...(enabled ? state : NOTHING_QUEUED),
    preview,
    change,
    pending,
    error,
    notice,
  };
}

export type PersonalPlanChange = ReturnType<typeof usePersonalPlanChange>;

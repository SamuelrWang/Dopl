"use client";

import { useApiQuery } from "@/shared/hooks/use-api-query";
import { useApiMutation } from "@/shared/hooks/use-api-mutation";
import { apiPathKey } from "@/shared/api/query-keys";
import type {
  CancelPlanResult,
  InvoiceDto,
  PaymentMethodDto,
} from "../billing-account";
import { BILLING_STATUS_PATH } from "./use-workspace-entitlements";

/**
 * The three client hooks over the workspace's Stripe account — card, invoices,
 * cancel/resume. Siblings of `use-workspace-entitlements.ts`, kept apart from
 * it because that hook is THE read every surface in the product makes and these
 * three are read by exactly one pane, by an ADMIN, on a page most members never
 * open.
 *
 * BOTH READS ARE GATED TWICE, and both gates matter. `enabled` keeps the
 * request from leaving at all for a member/viewer (the routes answer 403; a
 * pane that fires them anyway logs a 403 per mount for a card it will not
 * render), and the pane separately does not render the sections. The routes are
 * the actual authority — this is only about not asking.
 */

export const BILLING_PAYMENT_METHOD_PATH = "/api/billing/payment-method";
export const BILLING_INVOICES_PATH = "/api/billing/invoices";
export const BILLING_CANCEL_PATH = "/api/billing/cancel";

export function useWorkspacePaymentMethod(
  workspaceId: string | undefined,
  enabled: boolean
) {
  const query = useApiQuery<
    { paymentMethod: PaymentMethodDto | null },
    PaymentMethodDto | null
  >(BILLING_PAYMENT_METHOD_PATH, {
    workspaceId,
    enabled,
    select: (body) => body.paymentMethod ?? null,
  });
  return {
    // `undefined` while the read is in flight; `null` is a MEASURED "no card
    // on file". The pane renders a skeleton for the first and copy for the
    // second, so they may not collapse into one falsy check.
    paymentMethod: query.data,
    loading: enabled && query.isPending,
  };
}

export function useWorkspaceInvoices(
  workspaceId: string | undefined,
  enabled: boolean
) {
  const query = useApiQuery<{ invoices: InvoiceDto[] }, InvoiceDto[]>(
    BILLING_INVOICES_PATH,
    { workspaceId, enabled, select: (body) => body.invoices ?? [] }
  );
  return {
    invoices: query.data ?? [],
    loading: enabled && query.isPending,
  };
}

/** `{ resume: true }` clears the flag; anything else sets it. */
export interface CancelPlanDraft {
  resume?: boolean;
}

/**
 * Cancel (or resume) the workspace subscription.
 *
 * NO OPTIMISTIC PATCH, DELIBERATELY. The cache this write changes is the
 * billing STATUS payload, whose `cancelAtPeriodEnd` is one field on a row that
 * also carries the plan, the seat count and the credit meter — patching it
 * locally would be asserting the rest of that row is unchanged, which a Stripe
 * write is not entitled to assert. The round trip is one hop and the button
 * shows `pending`; the invalidation below is the path to the screen.
 */
export function useCancelPlan(workspaceId: string | undefined) {
  return useApiMutation<CancelPlanDraft, CancelPlanResult>({
    request: (draft) => ({
      path: BILLING_CANCEL_PATH,
      method: "POST",
      workspaceId,
      body: { resume: draft.resume === true },
    }),
    // Every workspace/query variant of the status read — the prefix key, never
    // a hand-typed tuple (§8).
    invalidate: () => [apiPathKey(BILLING_STATUS_PATH)],
  });
}

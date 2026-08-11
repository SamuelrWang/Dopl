"use client";

import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
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
 *
 * BOTH READS EXPOSE THREE OUTCOMES, NOT TWO. A Stripe call that THREW is not a
 * measured absence, and that difference is the whole point of these panes: "no
 * card on file" and "no invoices yet" are statements ABOUT the customer's
 * Stripe account, and printing either because a read failed tells an admin
 * their billing history is gone. `isError` is therefore part of the contract
 * here, not something a pane may infer from a falsy `data` — the panes branch
 * on it BEFORE they reach their empty state, and `retry` is what they offer
 * instead.
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
    // `undefined` while the read is in flight OR after it failed; `null` is a
    // MEASURED "no card on file". The pane renders a skeleton for the first,
    // an error for the second and copy for the third, so they may not collapse
    // into one falsy check.
    paymentMethod: query.data,
    loading: enabled && query.isPending,
    /** The read threw. `paymentMethod` is undefined for a reason that is NOT
     *  "Stripe has no card" — the pane must not say that it does. */
    isError: enabled && query.isError,
    retry: query.refetch,
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
    // `?? []` IS ONLY SAFE BECAUSE `isError` IS READ FIRST. On the failure path
    // this is the same empty array a customer with no invoices produces, and
    // the pane must not reach its empty state without checking.
    invoices: query.data ?? [],
    loading: enabled && query.isPending,
    isError: enabled && query.isError,
    retry: query.refetch,
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
 *
 * THE INVALIDATION IS AWAITED, AND `pending` COVERS IT (§8 rule 8). The status
 * read is what decides WHICH face this section wears — Cancel or Resume — so
 * between the POST resolving and that read landing the button still says
 * "Cancel plan" and is live again. A second click in that window is a second
 * POST for a decision already made. Holding `pending` across the invalidation
 * closes the gap, which is why this hook owns the invalidation itself rather
 * than declaring it on the mutation (`onSettled` fires it un-awaited, by
 * design, and there is nothing there to hold the control against).
 */
export function useCancelPlan(workspaceId: string | undefined) {
  const client = useQueryClient();
  const mutation = useApiMutation<CancelPlanDraft, CancelPlanResult>({
    request: (draft) => ({
      path: BILLING_CANCEL_PATH,
      method: "POST",
      workspaceId,
      body: { resume: draft.resume === true },
    }),
  });
  const [settling, setSettling] = useState(false);

  async function submit(draft: CancelPlanDraft): Promise<CancelPlanResult> {
    setSettling(true);
    try {
      return await mutation.mutateAsync(draft);
    } finally {
      // Both paths: a REFUSED cancel can still have moved Stripe (the local
      // row is written after the Stripe call), so the status read is suspect
      // either way. Every workspace/query variant of it — the prefix key,
      // never a hand-typed tuple (§8).
      await client.invalidateQueries({
        queryKey: apiPathKey(BILLING_STATUS_PATH),
      });
      setSettling(false);
    }
  }

  return { submit, pending: mutation.pending || settling };
}

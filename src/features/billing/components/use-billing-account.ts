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
 * Client hooks over the workspace's Stripe account — card, invoices,
 * cancel/resume. Separate from `use-workspace-entitlements.ts` (that one is THE
 * read every surface makes; these three are one admin pane).
 *
 * Reads gated twice: `enabled` stops a member/viewer request leaving at all
 * (routes answer 403), and the pane separately hides the sections. Routes are
 * the actual authority.
 *
 * ⚠ THREE OUTCOMES, NOT TWO. A Stripe call that THREW is not a measured
 * absence, so `isError` is part of the contract, not inferable from falsy
 * `data` — panes branch on it BEFORE their empty state and offer `retry`.
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
    // ⚠ `undefined` = in flight OR failed; `null` = MEASURED "no card on
    // file". Three renders — may not collapse into one falsy check.
    paymentMethod: query.data,
    loading: enabled && query.isPending,
    /** Read threw — `paymentMethod` undefined for a reason that is NOT
     *  "Stripe has no card". */
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
    // ⚠ `?? []` only safe because `isError` is read FIRST — on failure this is
    // the same empty array as a customer with no invoices.
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
 * NO optimistic patch: `cancelAtPeriodEnd` is one field on the billing STATUS
 * row that also carries plan, seat count and credit meter — patching locally
 * asserts the rest is unchanged, which a Stripe write cannot.
 *
 * ⚠ Invalidation is AWAITED and `pending` covers it (§8 rule 8): the status
 * read decides Cancel vs Resume, so between POST resolving and that read
 * landing, a live button is a second POST for a decision already made. Hence
 * this hook owns the invalidation rather than `onSettled` (fires un-awaited).
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
      // ⚠ Both paths: a REFUSED cancel can still have moved Stripe (local row
      // written after the Stripe call). Prefix key, never a hand-typed tuple (§8).
      await client.invalidateQueries({
        queryKey: apiPathKey(BILLING_STATUS_PATH),
      });
      setSettling(false);
    }
  }

  return { submit, pending: mutation.pending || settling };
}

"use client";
/* eslint-disable @typescript-eslint/no-unused-vars -- stubs keep the real signatures they stand in for */

import { useState } from "react";
import type { InvoiceDto } from "@/features/billing/billing-account";
import type { PersonalPaidPlan } from "@/features/billing/plans";
import type {
  PersonalPlanChange,
  UpgradePreview,
} from "@/features/billing/components/use-personal-plan-change";
import { STAGING_INVOICES } from "../settings-mock-data";

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * STUB of `@/features/billing/components/use-billing-account › useWorkspaceInvoices`: the fake
 * receipts, settled at once.
 */
export function useWorkspaceInvoices(_workspaceId: string | undefined, enabled: boolean) {
  return {
    invoices: enabled ? STAGING_INVOICES : ([] as InvoiceDto[]),
    loading: false,
    isError: false,
    retry: async () => undefined,
  };
}

/**
 * STUB of `@/features/billing/components/use-billing-account › useCancelPlan`. Pending for a beat,
 * then settles; the staged plan does not actually change (the status is fixed data).
 */
export function useCancelPlan(_workspaceId: string | undefined) {
  const [pending, setPending] = useState(false);
  async function submit(_draft: { resume?: boolean }) {
    setPending(true);
    await wait(600);
    setPending(false);
    return { ok: true } as const;
  }
  return { submit, pending };
}

/**
 * STUB of `@/features/billing/components/use-personal-plan-change › usePersonalPlanChange`.
 * `preview` answers a fixed proration so the real upgrade-confirm dialog opens; `change` waits and
 * reports a notice instead of moving any subscription.
 */
export function usePersonalPlanChange(
  _workspaceId: string | undefined,
  _enabled: boolean
): PersonalPlanChange {
  const [pending, setPending] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  return {
    plan: null,
    scheduledPlan: null,
    effectiveAt: null,
    async preview(_plan: PersonalPaidPlan): Promise<UpgradePreview | null> {
      await wait(200);
      return { amountDue: 1601, currency: "usd" };
    },
    async change(plan: PersonalPaidPlan): Promise<boolean> {
      setPending(true);
      await wait(600);
      setPending(false);
      setNotice(`Staging: would switch to ${plan}.`);
      return false;
    },
    pending,
    error: null,
    notice,
  };
}

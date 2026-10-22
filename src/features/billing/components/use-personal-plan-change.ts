"use client";

import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/shared/api/api-client";
import { apiPathKey } from "@/shared/api/query-keys";
import { userFacingMessage } from "@/shared/api/user-facing-message";
import { useApiQuery } from "@/shared/hooks/use-api-query";
import type { PersonalPaidPlan } from "../plans";
import { BILLING_STATUS_PATH } from "./use-workspace-entitlements";

/**
 * Client half of `POST/GET /api/billing/change-plan` — switching a LIVE home
 * space subscription between Pro and Max (2026-10-22). Pure API, no Stripe
 * script, so the web pane and the desktop SPA run it identically (the
 * `upgrade-to-team` switch has the same shape).
 *
 * The rules live server-side (`server/plan-change.ts`): an upgrade is immediate
 * and charged now, a downgrade waits for the period end, choosing the current
 * plan cancels a queued downgrade. This hook only reads the queued change for
 * the pane and fires the switch.
 */

export const BILLING_CHANGE_PLAN_PATH = "/api/billing/change-plan";

export interface PlanChangeStateDto {
  plan: PersonalPaidPlan | null;
  scheduledPlan: PersonalPaidPlan | null;
  effectiveAt: string | null;
}

const NOTHING_QUEUED: PlanChangeStateDto = {
  plan: null,
  scheduledPlan: null,
  effectiveAt: null,
};

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

  // Field-wise: the query cache is persisted (INVARIANTS §8), so a replayed or
  // partial body must not crash the pane.
  const raw = enabled ? query.data : undefined;
  const state: PlanChangeStateDto = {
    plan: raw?.plan ?? null,
    scheduledPlan: raw?.scheduledPlan ?? null,
    effectiveAt: raw?.effectiveAt ?? null,
  };

  async function change(plan: PersonalPaidPlan): Promise<boolean> {
    setPending(true);
    setError(null);
    try {
      await apiRequest(BILLING_CHANGE_PLAN_PATH, {
        method: "POST",
        workspaceId,
        body: { plan },
      });
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

  return { ...(enabled ? state : NOTHING_QUEUED), change, pending, error };
}

export type PersonalPlanChange = ReturnType<typeof usePersonalPlanChange>;

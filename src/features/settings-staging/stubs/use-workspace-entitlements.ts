"use client";
/* eslint-disable @typescript-eslint/no-unused-vars -- stubs keep the real signatures they stand in for */

import { useMemo } from "react";
import {
  MAX_PRICE,
  PRO_PRICE,
  SOLO_PRICE,
  TEAM_SEAT_PRICE,
  type WorkspaceEntitlements,
} from "@/features/billing/components/use-workspace-entitlements";
import { billingStatus } from "../settings-mock-data";
import { useStagingPlan } from "./staging-settings-state";

export type { WorkspaceEntitlements };

/**
 * STUB of `@/features/billing/components/use-workspace-entitlements › useWorkspaceEntitlements`.
 * Same derived fields as the real hook, computed over `settings-mock-data › billingStatus` for the
 * staging plan. `refresh` is a no-op; nothing is read from the network.
 */
export function useWorkspaceEntitlements(_workspaceId?: string): WorkspaceEntitlements {
  const plan = useStagingPlan();
  return useMemo(() => {
    const data = billingStatus(plan);
    const isSolo = (data.plan as string) === "solo";
    const isTeam = (data.plan as string) === "team";
    const isPro = data.plan === "pro";
    const isMax = (data.plan as string) === "max";
    const personalPlan = isPro ? ("pro" as const) : isMax ? ("max" as const) : null;
    const isPaid =
      (isSolo || isTeam || personalPlan !== null) &&
      (data.status === "active" || data.status === "past_due");
    const billableSeats = data.seatCount ?? data.memberCount;
    const monthlyTotal = personalPlan
      ? personalPlan === "max"
        ? MAX_PRICE
        : PRO_PRICE
      : isSolo
        ? SOLO_PRICE
        : billableSeats * TEAM_SEAT_PRICE;
    return {
      ...data,
      isPaid,
      isSolo,
      isTeam,
      isPro,
      isMax,
      personalPlan,
      isPastDue: data.status === "past_due",
      isCapped: data.objectCap !== null,
      overCap: data.objectCap !== null && !data.canCreateObjects,
      billableSeats,
      monthlyTotal,
      loading: false,
      refresh: (async () => undefined) as unknown as WorkspaceEntitlements["refresh"],
    } as WorkspaceEntitlements;
  }, [plan]);
}

"use client";

import { useEffect, useState } from "react";
import type { WorkspaceCreditsStatus } from "@/features/billing/components/use-workspace-entitlements";
import { creditState } from "../overview-mock-data";
import { useStagingState } from "./staging-state";

/**
 * STUB of `@/features/billing/components/use-workspace-entitlements › useWorkspaceEntitlements`,
 * the three fields the Overview reads: `loading`, `credits`, `isPaid`.
 * The plan comes from the staging toolbar.
 */
export function useWorkspaceEntitlements(workspaceId: string | undefined): {
  loading: boolean;
  credits: WorkspaceCreditsStatus;
  isPaid: boolean;
} {
  const { plan, load, epoch } = useStagingState();
  const key = `${plan}|${load}|${epoch}`;
  const [readyKey, setReadyKey] = useState<string | null>(null);
  useEffect(() => {
    if (load === "loading") return;
    const timer = setTimeout(() => setReadyKey(key), 250);
    return () => clearTimeout(timer);
  }, [key, load]);
  const state = creditState(plan);
  return {
    loading: !workspaceId || readyKey !== key,
    credits: state.credits,
    isPaid: state.isPaid,
  };
}

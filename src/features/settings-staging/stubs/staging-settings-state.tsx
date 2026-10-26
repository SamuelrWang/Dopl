"use client";

import { createContext, useContext, type ReactNode } from "react";
import type { StagingPlan } from "../settings-mock-data";

/**
 * STAGING ONLY — which plan the staged billing hooks answer for. `StagingSettingsModal` provides it
 * from its `plan` prop (overview-staging's toolbar drives it; `/popups` passes its own).
 */
const PlanContext = createContext<StagingPlan>("pro");

export function StagingPlanProvider({ plan, children }: { plan: StagingPlan; children: ReactNode }) {
  return <PlanContext.Provider value={plan}>{children}</PlanContext.Provider>;
}

export function useStagingPlan(): StagingPlan {
  return useContext(PlanContext);
}

"use client";

import { createContext, useContext, type ReactNode } from "react";
import type { StagingPlan } from "../overview-mock-data";

/**
 * STAGING-ONLY. The knobs the staging toolbar turns, read by the stubs so every desktop state the
 * Overview can reach (loading ghosts, error, empty account, free/paid/out-of-credits, the Devices
 * preview gate) is one click away. Nothing in the desktop app reads this; port nothing from here.
 */
export type StagingLoad = "ready" | "loading" | "error" | "empty";

export interface StagingState {
  load: StagingLoad;
  plan: StagingPlan;
  /** The branch gates the Devices preview on one user id; this flips that gate. */
  devicesPreview: boolean;
  /** Bumped by "Try again" so a stubbed read re-runs its fake latency. */
  epoch: number;
}

export const DEFAULT_STAGING_STATE: StagingState = {
  load: "ready",
  plan: "free",
  devicesPreview: true,
  epoch: 0,
};

const StagingContext = createContext<StagingState>(DEFAULT_STAGING_STATE);

export function StagingStateProvider({
  value,
  children,
}: {
  value: StagingState;
  children: ReactNode;
}) {
  return <StagingContext.Provider value={value}>{children}</StagingContext.Provider>;
}

export function useStagingState(): StagingState {
  return useContext(StagingContext);
}

"use client";

import { createContext, useContext, type ReactNode } from "react";
import { useOnboarding } from "./use-onboarding";
import { OnboardingCoachCard } from "./onboarding-tour";

/* ------------------------------------------------------------------ */
/*  Context                                                            */
/* ------------------------------------------------------------------ */

interface OnboardingContextValue {
  /** Mark an onboarding step as completed (triggers auto-advance if applicable). */
  completeStep: (key: string) => void;
  /** Panel type currently highlighted by onboarding (null = none). */
  highlightPanelType: string | null;
}

const OnboardingContext = createContext<OnboardingContextValue>({
  completeStep: () => {},
  highlightPanelType: null,
});

export function useOnboardingContext() {
  return useContext(OnboardingContext);
}

/* ------------------------------------------------------------------ */
/*  Provider                                                            */
/*                                                                      */
/*  After the /welcome flow was ripped out (M-7), the coach-card tour  */
/*  is gated purely on the persisted onboarding state from             */
/*  useOnboarding — a fresh user lands directly on /canvas and the     */
/*  tour fires until they complete or dismiss it. There is no longer  */
/*  a URL flag in front of it.                                          */
/* ------------------------------------------------------------------ */

interface OnboardingProviderProps {
  userId?: string;
  children: ReactNode;
}

export function OnboardingProvider({
  userId,
  children,
}: OnboardingProviderProps) {
  const {
    isActive,
    currentStep,
    currentStepDef,
    totalSteps,
    highlightPanelType,
    justCompleted,
    advance,
    completeStep,
    dismiss,
  } = useOnboarding(userId);

  const showCoachCard = isActive && currentStepDef;

  return (
    <OnboardingContext.Provider value={{ completeStep, highlightPanelType }}>
      {children}

      {showCoachCard && (
        <OnboardingCoachCard
          step={currentStepDef!}
          stepIndex={currentStep}
          totalSteps={totalSteps}
          justCompleted={justCompleted}
          onAdvance={advance}
          onDismiss={dismiss}
          onMcpConnected={() => completeStep("mcp_connect")}
        />
      )}
    </OnboardingContext.Provider>
  );
}

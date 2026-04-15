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

  return (
    <OnboardingContext.Provider value={{ completeStep, highlightPanelType }}>
      {children}

      {/* Old popup onboarding disabled — replaced by chat-based onboarding */}
      {false && isActive && currentStepDef && (
        <OnboardingCoachCard
          step={currentStepDef}
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

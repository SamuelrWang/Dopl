"use client";

import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import { useRouter } from "next/navigation";
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
/*  ?fromWelcome=1 gate                                                */
/*                                                                      */
/*  The coach-card tour runs only on the very first landing from the   */
/*  /welcome flow, identified by ?fromWelcome=1 in the URL. We read it */
/*  via window.location to avoid forcing a Suspense boundary on        */
/*  useSearchParams() in the root layout. Once the tour ends (or was   */
/*  already dismissed), the param is stripped so a refresh doesn't     */
/*  re-show it.                                                         */
/* ------------------------------------------------------------------ */

function useFromWelcomeFlag(): boolean {
  const [fromWelcome, setFromWelcome] = useState(false);
  useEffect(() => {
    if (typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    setFromWelcome(params.get("fromWelcome") === "1");
  }, []);
  return fromWelcome;
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
  const router = useRouter();
  const fromWelcome = useFromWelcomeFlag();
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

  const showCoachCard = fromWelcome && isActive && currentStepDef;

  // Clean the ?fromWelcome=1 flag once the tour wraps up (either completed
  // or dismissed) so a refresh doesn't try to re-activate anything.
  useEffect(() => {
    if (!fromWelcome) return;
    if (isActive) return;
    if (typeof window === "undefined") return;
    const url = new URL(window.location.href);
    if (url.searchParams.has("fromWelcome")) {
      url.searchParams.delete("fromWelcome");
      const next = url.pathname + (url.search ? url.search : "") + url.hash;
      router.replace(next);
    }
  }, [fromWelcome, isActive, router]);

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

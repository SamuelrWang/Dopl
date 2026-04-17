"use client";

import { useState, useEffect, useCallback, useRef } from "react";

/* ------------------------------------------------------------------ */
/*  Step definitions                                                    */
/* ------------------------------------------------------------------ */

export interface OnboardingStep {
  key: string;
  title: string;
  body: string;
  /** Panel type to highlight on the canvas (pulsing glow). null = no highlight. */
  highlight: string | null;
  /** If true, this step auto-advances when completeStep(key) is called. */
  autoAdvance: boolean;
}

// Post-welcome canvas tour. These three steps are shown as popup coach
// cards on top of /canvas right after the user finishes /welcome (signaled
// via ?fromWelcome=1). MCP connection and intro copy already happened on
// /welcome, so the tour is just a short orientation.
export const ONBOARDING_STEPS: OnboardingStep[] = [
  {
    key: "canvas_intro",
    title: "This is your Canvas",
    body: "It's where you'll find skills you create, sources you ingest, and a view of the digital brain your agent uses.",
    highlight: null,
    autoAdvance: false,
  },
  {
    key: "remote_capabilities",
    title: "Your agent can do this remotely too",
    body: "You can ingest X posts, chat, and create skills directly from your Canvas \u2014 and your agent can do all of it remotely through the MCP connection you just set up.",
    highlight: null,
    autoAdvance: false,
  },
  {
    key: "happy_building",
    title: "You're all set!",
    body: "If you ever have questions, ask your agent or me in chat. For now, explore the Canvas or head back to your agent and have it help you build your first skill.\n\nHappy building :)",
    highlight: null,
    autoAdvance: false,
  },
];

/* ------------------------------------------------------------------ */
/*  State                                                               */
/* ------------------------------------------------------------------ */

export interface OnboardingState {
  /** Index of the current step (0-based). -1 = onboarding complete. */
  currentStep: number;
  /** Set of step keys the user has completed (for auto-advance). */
  completedSteps: Record<string, boolean>;
  /** User explicitly dismissed the onboarding. */
  dismissed: boolean;
}

const STORAGE_PREFIX = "dopl:onboarding:";

function defaultState(): OnboardingState {
  return { currentStep: 0, completedSteps: {}, dismissed: false };
}

function loadState(userId: string): OnboardingState {
  if (typeof window === "undefined") return defaultState();
  try {
    const raw = localStorage.getItem(STORAGE_PREFIX + userId);
    if (!raw) return defaultState();
    return { ...defaultState(), ...JSON.parse(raw) };
  } catch {
    return defaultState();
  }
}

let dbTimer: ReturnType<typeof setTimeout> | null = null;

function persistState(userId: string, state: OnboardingState) {
  if (typeof window === "undefined") return;
  // localStorage (instant)
  try {
    localStorage.setItem(STORAGE_PREFIX + userId, JSON.stringify(state));
  } catch {
    // quota exceeded
  }
  // DB (debounced)
  if (dbTimer) clearTimeout(dbTimer);
  dbTimer = setTimeout(() => {
    fetch("/api/user/preferences/onboarding", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ value: state }),
    }).catch(() => {});
  }, 1000);
}

/* ------------------------------------------------------------------ */
/*  Hook                                                                */
/* ------------------------------------------------------------------ */

export function useOnboarding(userId?: string) {
  const id = userId ?? "anonymous";
  const [state, setState] = useState<OnboardingState>(defaultState);
  const [justCompleted, setJustCompleted] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    // Load from localStorage first (instant)
    setState(loadState(id));
    // Then fetch from DB and merge
    fetch("/api/user/preferences/onboarding")
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (data?.value && typeof data.value === "object") {
          setState((prev) => {
            const dbState = { ...defaultState(), ...data.value } as OnboardingState;
            // DB wins if it shows more progress
            if (dbState.dismissed || dbState.currentStep > prev.currentStep) {
              // Also update localStorage cache
              try { localStorage.setItem(STORAGE_PREFIX + id, JSON.stringify(dbState)); } catch {}
              return dbState;
            }
            return prev;
          });
        }
      })
      .catch(() => {});
  }, [id]);

  const isActive =
    !state.dismissed &&
    state.currentStep >= 0 &&
    state.currentStep < ONBOARDING_STEPS.length;

  const currentStepDef = isActive ? ONBOARDING_STEPS[state.currentStep] : null;
  const highlightPanelType = currentStepDef?.highlight ?? null;

  /** Advance to the next step (or finish if on the last step). */
  const advance = useCallback(() => {
    setJustCompleted(false);
    setState((prev) => {
      const nextIdx = prev.currentStep + 1;
      const next: OnboardingState =
        nextIdx >= ONBOARDING_STEPS.length
          ? { ...prev, currentStep: -1, dismissed: true }
          : { ...prev, currentStep: nextIdx };
      persistState(id, next);
      return next;
    });
  }, [id]);

  /** Mark a step as completed. If it's the current step and autoAdvance, auto-advance after a brief flash. */
  const completeStep = useCallback(
    (key: string) => {
      setState((prev) => {
        if (prev.completedSteps[key]) return prev; // already done
        const next = {
          ...prev,
          completedSteps: { ...prev.completedSteps, [key]: true },
        };
        persistState(id, next);

        // Auto-advance if this is the current step
        const currentDef = ONBOARDING_STEPS[prev.currentStep];
        if (currentDef && currentDef.key === key && currentDef.autoAdvance) {
          setJustCompleted(true);
          if (timerRef.current) clearTimeout(timerRef.current);
          timerRef.current = setTimeout(() => {
            setJustCompleted(false);
            setState((p) => {
              const nextIdx = p.currentStep + 1;
              const advanced: OnboardingState =
                nextIdx >= ONBOARDING_STEPS.length
                  ? { ...p, currentStep: -1, dismissed: true }
                  : { ...p, currentStep: nextIdx };
              persistState(id, advanced);
              return advanced;
            });
          }, 1200);
        }

        return next;
      });
    },
    [id],
  );

  /** Dismiss onboarding entirely. */
  const dismiss = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    setState((prev) => {
      const next = { ...prev, currentStep: -1, dismissed: true };
      persistState(id, next);
      return next;
    });
  }, [id]);

  // Cleanup timer on unmount
  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  return {
    isActive,
    currentStep: state.currentStep,
    currentStepDef,
    totalSteps: ONBOARDING_STEPS.length,
    highlightPanelType,
    justCompleted,
    advance,
    completeStep,
    dismiss,
  };
}

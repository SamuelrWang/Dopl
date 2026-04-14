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

export const ONBOARDING_STEPS: OnboardingStep[] = [
  {
    key: "welcome",
    title: "Welcome to the Setup Intelligence Engine",
    body: "This is your workspace for discovering, organizing, and building on real-world AI and automation implementations. I'll walk you through the key features \u2014 each step takes about 10 seconds.",
    highlight: null,
    autoAdvance: false,
  },
  {
    key: "api_key",
    title: "Your API Key & MCP Connection",
    body: "This panel holds your API key \u2014 a unique identifier that lets external AI tools (like Claude Code) connect to your workspace. You'll use this later to connect your AI assistant so it can search your knowledge base, focus on clusters, and execute automations. For now, just know it's here.",
    highlight: "connection",
    autoAdvance: false,
  },
  {
    key: "browse",
    title: "Browse Existing Setups",
    body: "The knowledge base has hundreds of pre-ingested setups \u2014 agent workflows, n8n automations, API integrations, and more. Browse them, filter by use case or complexity, and add any to your canvas with one click.\n\nClick the Browse panel on your canvas, or the Browse tab in the nav bar.",
    highlight: "browse",
    autoAdvance: true,
  },
  {
    key: "cluster",
    title: "Group Panels into Clusters",
    body: "This is where it gets powerful. Select 2 or more panels (shift-click or drag a selection box around them), then click \u2018Cluster\u2019 in the menu that appears.\n\nClusters create a shared context \u2014 any chat panel inside a cluster automatically sees all the entries in it. The cluster also gets its own \u2018brain\u2019 with synthesized instructions and persistent memories.",
    highlight: null,
    autoAdvance: true,
  },
  {
    key: "chat_in_cluster",
    title: "Chat Inside a Cluster",
    body: "Open a chat panel (from the bottom bar) and drag it into a cluster. When you send a message, the AI can see every entry in that cluster \u2014 their READMEs, setup instructions, and metadata.\n\nAsk it to compare approaches, explain how something works, or build a composite solution. The AI is fully cluster-aware.",
    highlight: null,
    autoAdvance: true,
  },
  {
    key: "mcp_connect",
    title: "Connect Your AI Assistant — Right Now",
    body: "Let\u2019s connect Claude Code (or any MCP tool) to your workspace. Copy the config below and paste it into your MCP settings. Once connected, your AI can search your knowledge base, manage your canvas, and focus on clusters.",
    highlight: "connection",
    autoAdvance: true,
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

const STORAGE_PREFIX = "sie:onboarding:";

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

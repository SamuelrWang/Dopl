"use client";

import { useRouter } from "next/navigation";
import type { OnboardingStep } from "../types";
import { OnboardingFlowCore } from "./onboarding-flow-core";

interface OnboardingFlowProps {
  initialStep: OnboardingStep;
  /** Deep-link passthrough; server re-validates via safeRedirect. */
  redirectTo?: string;
}

/**
 * Client stepper for /onboarding: survey → MCP connect → (transition) workspace.
 *
 * The markup, the steps and both writes live in `./onboarding-flow-core`, which
 * takes the post-completion navigation as a prop; this file is only the
 * `next/navigation` binding plus the web app's brand mark, so the desktop SPA
 * reuses the same flow with its own router (the wave-1 core/binding pattern).
 */
export function OnboardingFlow({ initialStep, redirectTo }: OnboardingFlowProps) {
  const router = useRouter();

  return (
    <OnboardingFlowCore
      initialStep={initialStep}
      redirectTo={redirectTo}
      onDone={(to) => router.push(to)}
      brand={
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src="/favicons/android-chrome-512x512.png"
          alt="Dopl"
          className="auth-logo-3d h-8 w-8 rounded-[6px]"
        />
      }
    />
  );
}

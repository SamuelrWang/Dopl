"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { AuthSplitLayout } from "@/shared/layout/auth-split";
import { useMcpConnectionPoll } from "../hooks/use-mcp-connection-poll";
import type { OnboardingStep, SurveySubmission } from "../types";
import { McpConnectStep } from "./mcp-connect-step";
import { SurveyStep } from "./survey-step";

interface OnboardingFlowProps {
  initialStep: OnboardingStep;
  /** Deep-link passthrough; server re-validates via safeRedirect. */
  redirectTo?: string;
}

/**
 * Client stepper for /onboarding: survey → MCP connect → (transition) workspace.
 * Reuses the login split layout — the questionnaire fades in on the left where
 * the sign-in form was, crystal panel on the right. Completion renames the
 * auto-provisioned workspace and routes into it.
 */
export function OnboardingFlow({ initialStep, redirectTo }: OnboardingFlowProps) {
  const router = useRouter();
  const [step, setStep] = useState<OnboardingStep>(initialStep);
  const [submitting, setSubmitting] = useState(false);
  const [finishing, setFinishing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [leaving, setLeaving] = useState(false);
  const finishRef = useRef(false);

  const connected = useMcpConnectionPoll(step === "connect" && !finishing);

  function changeStep(next: OnboardingStep) {
    setLeaving(true);
    setTimeout(() => {
      setStep(next);
      setLeaving(false);
    }, 200);
  }

  async function handleSurveySubmit(answers: SurveySubmission) {
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch("/api/onboarding/survey", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(answers),
      });
      if (!res.ok) throw new Error("Survey submit failed");
      changeStep("connect");
    } catch {
      setError("Couldn't save your answers. Please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  async function finish(mcpConnected: boolean) {
    if (finishRef.current) return;
    finishRef.current = true;
    setFinishing(true);
    setError(null);
    try {
      const res = await fetch("/api/onboarding/complete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mcpConnected, redirectTo }),
      });
      if (!res.ok) throw new Error("Complete failed");
      const body = (await res.json()) as { redirectTo: string };
      try {
        window.localStorage.setItem("dopl:welcome", "1");
      } catch {
        // storage unavailable — the welcome popup just won't show
      }
      router.push(body.redirectTo);
    } catch {
      finishRef.current = false;
      setFinishing(false);
      setError("Couldn't set up your workspace. Please try again.");
    }
  }

  // No auto-advance: the user clicks Continue (enabled once connected) to finish.

  return (
    <AuthSplitLayout>
      <div className="w-full max-w-[360px]" style={{ animation: "loginFadeIn 0.6s ease-out both" }}>
        {/* Brand: logo + wordmark (matches login), then step indicator */}
        <div className="mb-6 flex flex-col items-start gap-1.5">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/favicons/android-chrome-512x512.png" alt="Dopl" className="auth-logo-3d h-8 w-8 rounded-[6px]" />
          <span
            className="text-[21px] font-medium text-[#181818]"
            style={{ fontFamily: "var(--font-playfair), Georgia, serif", fontStyle: "italic" }}
          >
            Dopl
          </span>
          <p className="mt-1 font-mono text-[11px] uppercase tracking-[0.12em] text-[#9a9a9a]">
            Step {step === "survey" ? "1" : "2"} of 2
          </p>
        </div>

        {error && (
          <div className="mb-5 rounded-[10px] border border-red-300 bg-red-50 px-4 py-3 text-[14px] text-red-700">
            {error}
            {!finishRef.current && step !== "survey" && (
              <button
                type="button"
                onClick={() => void finish(connected)}
                className="ml-2 cursor-pointer font-semibold underline underline-offset-2"
              >
                Retry
              </button>
            )}
          </div>
        )}

        <div
          style={{
            opacity: leaving ? 0 : 1,
            transform: leaving ? "translateY(6px)" : "none",
            transition: "opacity 200ms ease, transform 200ms ease",
          }}
        >
          {finishing ? (
            <div className="flex flex-col items-start gap-4 py-10">
              <div className="h-7 w-7 animate-spin rounded-full border-2 border-[#181818]/20 border-t-[#181818]" />
              <p className="text-[15px] text-[#666]">Setting up your workspace…</p>
            </div>
          ) : step === "survey" ? (
            <SurveyStep submitting={submitting} onSubmit={handleSurveySubmit} />
          ) : (
            <McpConnectStep
              connected={connected}
              finishing={finishing}
              onContinue={() => void finish(true)}
            />
          )}
        </div>
      </div>
    </AuthSplitLayout>
  );
}

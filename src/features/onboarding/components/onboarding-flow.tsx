"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
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
 * Client stepper for /onboarding: survey → MCP connect → (transition)
 * workspace. The workspace step is invisible — completion renames the
 * auto-provisioned workspace and routes straight into it. Styling
 * follows the knowledge-landing colorway (app-shell.module.css).
 */
export function OnboardingFlow({ initialStep, redirectTo }: OnboardingFlowProps) {
  const router = useRouter();
  const [step, setStep] = useState<OnboardingStep>(initialStep);
  const [submitting, setSubmitting] = useState(false);
  const [finishing, setFinishing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const finishRef = useRef(false);

  const connected = useMcpConnectionPoll(step === "connect" && !finishing);

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
      setStep("connect");
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
      router.push(body.redirectTo);
    } catch {
      finishRef.current = false;
      setFinishing(false);
      setError("Couldn't set up your workspace. Please try again.");
    }
  }

  // Agent connected — show the green state for a beat, then finish.
  useEffect(() => {
    if (step !== "connect" || !connected) return;
    const timer = setTimeout(() => void finish(true), 1200);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [connected, step]);

  return (
    <div
      className="w-full max-w-xl"
      style={{ animation: "loginFadeIn 0.6s ease-out both" }}
    >
      <div className="mb-7 flex items-center justify-between">
        <h2
          className="text-2xl font-medium text-[#232a31]"
          style={{
            fontFamily: "var(--font-playfair), Georgia, serif",
            fontStyle: "italic",
          }}
        >
          Dopl
        </h2>
        <span className="font-mono text-[10px] uppercase tracking-[0.08em] text-[#98a2ad]">
          {step === "survey" ? "01 / 02" : "02 / 02"}
        </span>
      </div>

      <div className="rounded-[20px] border-[1.5px] border-[#d6dde5] bg-[#fbfcfd] p-8 shadow-[0_6px_30px_rgba(28,33,39,0.08)]">
        {error && (
          <div className="mb-5 p-3 rounded-[11px] border-[1.5px] border-red-200 bg-red-50">
            <p className="text-[13px] text-red-600">{error}</p>
            {finishRef.current === false && step === "connect" && (
              <button
                type="button"
                onClick={() => void finish(connected)}
                className="mt-1.5 text-[13px] font-semibold text-red-600 underline underline-offset-2 cursor-pointer"
              >
                Retry
              </button>
            )}
          </div>
        )}

        {finishing ? (
          <div className="py-16 flex flex-col items-center gap-4">
            <div className="w-8 h-8 rounded-full border-2 border-[#6f93bf]/30 border-t-[#6f93bf] animate-spin" />
            <p className="text-[15px] text-[#646d78]">
              Setting up your workspace…
            </p>
          </div>
        ) : step === "survey" ? (
          <SurveyStep submitting={submitting} onSubmit={handleSurveySubmit} />
        ) : (
          <McpConnectStep
            connected={connected}
            finishing={finishing}
            onSkip={() => void finish(false)}
          />
        )}
      </div>
    </div>
  );
}

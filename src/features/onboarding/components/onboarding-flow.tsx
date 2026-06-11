"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { MonoLabel } from "@/shared/design";
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
 * auto-provisioned workspace and routes straight into it.
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
      <div className="mb-8 flex items-center justify-between">
        <h2
          className="text-xl font-bold text-[var(--text-primary)]"
          style={{
            fontFamily: "var(--font-playfair), 'Playfair Display', serif",
            fontStyle: "italic",
          }}
        >
          Dopl
        </h2>
        <MonoLabel tone="muted">
          {step === "survey" ? "01 / 02" : "02 / 02"}
        </MonoLabel>
      </div>

      <div className="rounded-2xl border border-[var(--border-default)] bg-[var(--bg-elevated)] p-8 shadow-2xl">
        {error && (
          <div className="mb-5 p-3 rounded-lg border border-red-400/20 bg-red-400/[0.06]">
            <p className="font-mono text-[10px] text-red-300">{error}</p>
            {finishRef.current === false && step === "connect" && (
              <button
                type="button"
                onClick={() => void finish(connected)}
                className="mt-1.5 font-mono text-[10px] uppercase tracking-wider text-red-300 underline underline-offset-2 cursor-pointer"
              >
                Retry
              </button>
            )}
          </div>
        )}

        {finishing ? (
          <div className="py-16 flex flex-col items-center gap-4">
            <div className="w-8 h-8 rounded-full border-2 border-[var(--accent-primary)]/30 border-t-[var(--accent-primary)] animate-spin" />
            <p className="text-sm text-[var(--text-muted)]">
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

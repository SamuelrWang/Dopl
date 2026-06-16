"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useMcpConnectionPoll } from "../hooks/use-mcp-connection-poll";
import type { OnboardingStep, SurveySubmission } from "../types";
import { McpConnectStep } from "./mcp-connect-step";
import { SeedStep } from "./seed-step";
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
  const [leaving, setLeaving] = useState(false);
  const finishRef = useRef(false);
  const advancedRef = useRef(false);

  const connected = useMcpConnectionPoll(step === "connect" && !finishing);

  // Fade the current step out, swap, fade the next in.
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
      router.push(body.redirectTo);
    } catch {
      finishRef.current = false;
      setFinishing(false);
      setError("Couldn't set up your workspace. Please try again.");
    }
  }

  // Agent connected. Don't yank the user forward while they're away in their
  // agent — if this tab is hidden, wait until they come back, THEN fade to
  // the seeding step (after a short beat so they register the "Connected"
  // state). No hidden auto-advance.
  useEffect(() => {
    if (step !== "connect" || !connected || advancedRef.current) return;

    let timer: ReturnType<typeof setTimeout> | undefined;
    const advance = () => {
      if (advancedRef.current) return;
      advancedRef.current = true;
      setLeaving(true);
      setTimeout(() => {
        setStep("seed");
        setLeaving(false);
      }, 200);
    };
    const schedule = () => {
      timer = setTimeout(
        advance,
        document.visibilityState === "visible" ? 1200 : 600
      );
    };

    if (document.visibilityState === "visible") {
      schedule();
      return () => {
        if (timer) clearTimeout(timer);
      };
    }

    const onVisible = () => {
      if (document.visibilityState !== "visible") return;
      document.removeEventListener("visibilitychange", onVisible);
      schedule();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      document.removeEventListener("visibilitychange", onVisible);
      if (timer) clearTimeout(timer);
    };
  }, [connected, step]);

  return (
    <div
      className="w-full max-w-xl"
      style={{ animation: "loginFadeIn 0.6s ease-out both" }}
    >
      <div className="mb-6 flex flex-col items-center gap-2">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src="/favicons/android-chrome-512x512.png"
          alt="Dopl"
          className="h-10 w-10 rounded-[10px]"
        />
        <span className="font-mono text-[10px] uppercase tracking-[0.08em] text-[#98a2ad]">
          {step === "survey"
            ? "01 / 03"
            : step === "connect"
              ? "02 / 03"
              : "03 / 03"}
        </span>
      </div>

      <div
        className="flex flex-col overflow-hidden rounded-[20px] border-[1.5px] border-[#d6dde5] bg-[#fbfcfd] shadow-[0_6px_30px_rgba(28,33,39,0.08)]"
        style={{ height: "min(78vh, 640px)" }}
      >
        <div className="flex-1 min-h-0 overflow-y-auto p-8">
          {error && (
            <div className="mb-5 p-3 rounded-[11px] border-[1.5px] border-red-200 bg-red-50">
              <p className="text-[13px] text-red-600">{error}</p>
              {finishRef.current === false && step !== "survey" && (
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

          <div
            style={{
              opacity: leaving ? 0 : 1,
              transform: leaving ? "translateY(6px)" : "none",
              transition: "opacity 200ms ease, transform 200ms ease",
            }}
          >
            {finishing ? (
              <div className="py-16 flex flex-col items-center gap-4">
                <div className="w-8 h-8 rounded-full border-2 border-[#6f93bf]/30 border-t-[#6f93bf] animate-spin" />
                <p className="text-[15px] text-[#646d78]">
                  Setting up your workspace…
                </p>
              </div>
            ) : step === "survey" ? (
              <SurveyStep submitting={submitting} onSubmit={handleSurveySubmit} />
            ) : step === "connect" ? (
              <McpConnectStep
                connected={connected}
                finishing={finishing}
                onSkip={() => void finish(false)}
                showSkip={false}
              />
            ) : (
              <SeedStep finishing={finishing} onFinish={() => void finish(true)} />
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

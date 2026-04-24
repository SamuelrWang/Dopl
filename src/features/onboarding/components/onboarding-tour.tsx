"use client";

/**
 * OnboardingCoachCard — a non-blocking coaching card in the top-right corner
 * that guides new users through the app one step at a time.
 *
 * - Shows progress (step N of M)
 * - Renders the current step's title, body, and highlight target
 * - "Next" / "Got it" / "Let's go" / "Finish" depending on step
 * - "Skip" on auto-advance steps (where the user can do the action OR skip)
 * - Brief "Nice!" flash when an auto-advance step is completed
 * - "Dismiss" link to close onboarding permanently
 */

import type { OnboardingStep } from "./use-onboarding";
import { McpConnectStep } from "./mcp-connect-step";

interface OnboardingCoachCardProps {
  step: OnboardingStep;
  stepIndex: number;
  totalSteps: number;
  justCompleted: boolean;
  onAdvance: () => void;
  onDismiss: () => void;
  /** Called by the McpConnectStep when connection is detected. */
  onMcpConnected: () => void;
}

export function OnboardingCoachCard({
  step,
  stepIndex,
  totalSteps,
  justCompleted,
  onAdvance,
  onDismiss,
  onMcpConnected,
}: OnboardingCoachCardProps) {
  const isFirst = stepIndex === 0;
  const isLast = stepIndex === totalSteps - 1;

  // Button label depends on context
  const buttonLabel = isFirst
    ? "Let\u2019s go"
    : isLast
      ? "Finish"
      : step.autoAdvance
        ? "Skip"
        : "Got it";

  return (
    <div
      className="fixed top-20 right-4 z-[9990] w-[340px]"
      style={{ animation: "coachCardIn 0.3s ease-out both" }}
    >
      <div className="bg-[oklch(0.07_0_0)] border border-white/[0.12] rounded-2xl shadow-[0_8px_32px_rgba(0,0,0,0.5),inset_0_1px_0_rgba(255,255,255,0.08)] overflow-hidden">
        {/* Progress bar */}
        <div className="h-[2px] bg-white/[0.06]">
          <div
            className="h-full bg-[var(--accent-primary,#a78bfa)] transition-all duration-500 ease-out"
            style={{ width: `${((stepIndex + 1) / totalSteps) * 100}%` }}
          />
        </div>

        <div className="p-5">
          {/* Header row: step counter + dismiss */}
          <div className="flex items-center justify-between mb-3">
            <span className="text-[10px] uppercase tracking-[0.2em] text-white/35 font-mono">
              Step {stepIndex + 1} of {totalSteps}
            </span>
            <button
              onClick={onDismiss}
              className="text-[10px] uppercase tracking-[0.15em] text-white/25 hover:text-white/50 font-mono transition-colors"
            >
              Dismiss
            </button>
          </div>

          {/* Auto-advance success flash */}
          {justCompleted ? (
            <div
              className="py-4 text-center"
              style={{ animation: "coachFlash 0.4s ease-out both" }}
            >
              <p className="text-sm font-mono text-[var(--accent-primary,#a78bfa)] uppercase tracking-wider font-medium">
                Nice!
              </p>
            </div>
          ) : (
            <>
              {/* Title */}
              <h3 className="text-[13px] font-mono font-medium text-white/90 leading-snug mb-3">
                {step.title}
              </h3>

              {/* Body — supports \n for paragraph breaks */}
              <div className="space-y-2 mb-5">
                {step.body.split("\n\n").map((paragraph, i) => (
                  <p
                    key={i}
                    className="text-[12px] font-mono leading-[1.65] text-white/55"
                  >
                    {paragraph}
                  </p>
                ))}
              </div>

              {/* MCP connection step — inline config + polling */}
              {step.key === "mcp_connect" && (
                <div className="mb-4">
                  <McpConnectStep onConnected={onMcpConnected} />
                </div>
              )}

              {/* Highlight hint */}
              {step.highlight && step.key !== "mcp_connect" && (
                <p className="text-[10px] uppercase tracking-[0.15em] text-white/25 font-mono mb-4">
                  {step.highlight === "connection"
                    ? "\u2190 Look at the connection panel"
                    : step.highlight === "browse"
                      ? "\u2191 Check the Browse tab"
                      : `\u2190 ${step.highlight}`}
                </p>
              )}

              {/* Action button */}
              <button
                onClick={onAdvance}
                className="w-full px-4 py-2 text-[11px] uppercase tracking-[0.15em] font-mono font-medium rounded-lg transition-all cursor-pointer
                  bg-white/[0.08] text-white/80 hover:bg-white/[0.14] hover:text-white
                  border border-white/[0.08] hover:border-white/[0.15]"
              >
                {buttonLabel}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

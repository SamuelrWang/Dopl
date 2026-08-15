"use client";

import { useRef, useState, type ReactNode } from "react";
import { apiRequest } from "@/shared/api/api-client";
import { AuthSplitLayout } from "@/shared/layout/auth-split";
import { useMcpConnectionPoll } from "../hooks/use-mcp-connection-poll";
import type { OnboardingStep, SurveySubmission } from "../types";
import { McpConnectStep } from "./mcp-connect-step";
import { ProvisioningChecklist } from "./provisioning-checklist";
import { SurveyStep } from "./survey-step";
import { WorkspaceNameStep } from "./workspace-name-step";

interface FinishArgs {
  mcpConnected: boolean;
  name?: string;
  description?: string;
}

export interface OnboardingFlowCoreProps {
  initialStep: OnboardingStep;
  /** Deep-link passthrough; the server re-validates via safeRedirect. */
  redirectTo?: string;
  /** Fires with the server-chosen landing path. Router-agnostic: web pushes
   *  via `next/navigation`, desktop SPA uses its hash router. */
  onDone: (redirectTo: string) => void;
  /** Brand mark above the wordmark. ⚠ Packaged SPA passes nothing: it is a
   *  `file://` document where `/favicons/...` resolves to filesystem root. */
  brand?: ReactNode;
  /** Right-pane banner, passed through to `AuthSplitLayout`. Same `file://`
   *  problem as `brand`: packaged SPA hands a Vite-bundled asset URL, else the
   *  layout's `public/` default. Why the shared file can't import the image:
   *  `shared/layout/auth-split/auth-split-layout.tsx` › AuthSplitLayout. */
  bannerSrc?: string;
}

/**
 * Onboarding stepper core, Next-free (web binding: `./onboarding-flow`):
 * survey → MCP connect → workspace naming, on the login split layout.
 *
 * ⚠ Writes must go through `apiRequest`, not raw `fetch` — packaged desktop
 * renderer ships `connect-src 'none'` and rides that seam over IPC.
 */
export function OnboardingFlowCore({
  initialStep,
  redirectTo,
  onDone,
  brand,
  bannerSrc,
}: OnboardingFlowCoreProps) {
  const [step, setStep] = useState<OnboardingStep>(initialStep);
  const [submitting, setSubmitting] = useState(false);
  const [finishing, setFinishing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [leaving, setLeaving] = useState(false);
  const finishRef = useRef(false);
  // Retry needs the last finish payload or it loses name/description.
  const finishArgsRef = useRef<FinishArgs>({ mcpConnected: true });

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
      await apiRequest<{ ok: boolean }>("/api/onboarding/survey", {
        method: "POST",
        body: answers,
      });
      changeStep("connect");
    } catch {
      setError("Couldn't save your answers. Please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  async function finish(args: FinishArgs) {
    if (finishRef.current) return;
    finishRef.current = true;
    finishArgsRef.current = args;
    setFinishing(true);
    setError(null);
    try {
      const body = await apiRequest<{ redirectTo: string }>(
        "/api/onboarding/complete",
        {
          method: "POST",
          body: {
            mcpConnected: args.mcpConnected,
            name: args.name,
            description: args.description,
            redirectTo,
          },
        }
      );
      try {
        window.localStorage.setItem("dopl:welcome", "1");
      } catch {
        // storage unavailable — welcome popup just won't show
      }
      onDone(body.redirectTo);
    } catch {
      finishRef.current = false;
      setFinishing(false);
      setError("Couldn't set up your workspace. Please try again.");
    }
  }

  return (
    <AuthSplitLayout bannerSrc={bannerSrc}>
      <div className="w-full max-w-[360px]" style={{ animation: "loginFadeIn 0.6s ease-out both" }}>
        {/* Brand: mark + wordmark (matches login), then step indicator */}
        <div className="mb-6 flex flex-col items-start gap-1.5">
          {brand}
          <span
            className="text-[21px] font-medium text-[#181818]"
            style={{ fontFamily: "var(--font-playfair), Georgia, serif", fontStyle: "italic" }}
          >
            Dopl
          </span>
          <p className="mt-1 font-mono text-[11px] uppercase tracking-[0.12em] text-[#9a9a9a]">
            Step {step === "survey" ? "1" : step === "connect" ? "2" : "3"} of 3
          </p>
        </div>

        {error && (
          <div className="mb-5 rounded-[10px] border border-red-300 bg-red-50 px-4 py-3 text-[14px] text-red-700">
            {error}
            {!finishRef.current && step === "workspace" && (
              <button
                type="button"
                onClick={() => void finish(finishArgsRef.current)}
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
            <ProvisioningChecklist />
          ) : step === "survey" ? (
            <SurveyStep submitting={submitting} onSubmit={handleSurveySubmit} />
          ) : step === "connect" ? (
            <McpConnectStep
              connected={connected}
              finishing={finishing}
              onContinue={() => changeStep("workspace")}
            />
          ) : (
            <WorkspaceNameStep
              submitting={finishing}
              onSubmit={(name, description) =>
                void finish({
                  mcpConnected: true,
                  name: name || undefined,
                  description: description || undefined,
                })
              }
            />
          )}
        </div>
      </div>
    </AuthSplitLayout>
  );
}

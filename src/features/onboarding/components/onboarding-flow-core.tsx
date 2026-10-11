"use client";

import { useRef, useState, type ReactNode } from "react";
import { apiRequest } from "@/shared/api/api-client";
import { AuthSplitLayout, type AuthGlassPose } from "@/shared/layout/auth-split";
import { useMcpConnectionPoll } from "../hooks/use-mcp-connection-poll";
import type { OnboardingStep, SurveySubmission } from "../types";
import { McpConnectStep } from "./mcp-connect-step";
import { ProvisioningChecklist } from "./provisioning-checklist";
import { SurveyStep } from "./survey-step";
import { WorkspaceNameStep } from "./workspace-name-step";

/**
 * The banner glass panel's pose per step. The layout owns the motion; this is
 * only which of its three poses the step wants, and going BACK a step reverses
 * the same animation for free.
 *
 * Step 3 is `default` on purpose: the plain centred rounded rect the panel has
 * always been.
 */
const GLASS_POSE: Record<OnboardingStep, AuthGlassPose> = {
  survey: "lowered-top-notch",
  connect: "raised-bottom-notch",
  workspace: "default",
};

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
  /**
   * 🔒 COPY-PREVIEW ONLY, and the one caller is a `import.meta.env.DEV` branch
   * in the desktop SPA's `/onboarding` page. True means: render every step for
   * review and WRITE NOTHING — neither `POST /api/onboarding/survey` nor
   * `POST /api/onboarding/complete` fires, and `onDone` never runs, so an
   * already-onboarded reviewer's account and workspace names are untouched.
   * Also surfaces a step jumper, since the real step 2 → 3 gate needs a live
   * MCP connection. Defaults false: zero effect on the real flow.
   */
  previewOnly?: boolean;
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
  previewOnly = false,
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
    // Preview: advance the stepper, send nothing.
    if (previewOnly) {
      changeStep("connect");
      return;
    }
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
    // Preview: show the provisioning checklist, which is a screen worth
    // reviewing, but neither write nor navigate. Reload to start over.
    if (previewOnly) {
      setFinishing(true);
      return;
    }
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
      // ⚠ `dopl:welcome` WAS SET HERE AND IS DELETED (Samuel's ruling R-49,
      // 2026-09-17): the welcome popup that read it is gone, and a write with
      // no reader is dead code, not a seam for a reimplementation.
      onDone(body.redirectTo);
    } catch {
      finishRef.current = false;
      setFinishing(false);
      setError("Couldn't set up your home space. Please try again.");
    }
  }

  return (
    <AuthSplitLayout bannerSrc={bannerSrc} glassPose={GLASS_POSE[step]}>
      <div className="w-full max-w-[360px]" style={{ animation: "loginFadeIn 0.6s ease-out both" }}>
        {/* Brand: mark BESIDE the wordmark as one lockup, then step indicator */}
        <div className="mb-6 flex flex-col items-start gap-1.5">
          <div className="flex items-center gap-2.5">
            {brand}
            <span
              className="text-[21px] font-medium text-[#181818]"
              style={{ fontFamily: "var(--font-playfair), Georgia, serif", fontStyle: "italic" }}
            >
              Dopl
            </span>
          </div>
          <p className="mt-1 font-mono text-[11px] uppercase tracking-[0.12em] text-[#9a9a9a]">
            Step {step === "survey" ? "1" : step === "connect" ? "2" : "3"} of 3
          </p>
        </div>

        {previewOnly && (
          <div className="mb-5 rounded-[10px] border border-dashed border-[#c9c9c9] bg-[#f7f7f7] px-3.5 py-2.5">
            <p className="font-mono text-[10px] uppercase tracking-[0.12em] text-[#9a9a9a]">
              Preview, nothing is saved
            </p>
            <div className="mt-2 flex gap-1.5">
              {(["survey", "connect", "workspace"] as const).map((s, i) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => {
                    setFinishing(false);
                    changeStep(s);
                  }}
                  className={`cursor-pointer rounded-full px-3 py-1 text-[12px] font-medium transition-colors ${
                    step === s && !finishing
                      ? "bg-[#181818] text-white"
                      : "bg-white text-[#74808C] hover:text-[#181818]"
                  }`}
                >
                  {i + 1}
                </button>
              ))}
              <button
                type="button"
                onClick={() => setFinishing(true)}
                className={`cursor-pointer rounded-full px-3 py-1 text-[12px] font-medium transition-colors ${
                  finishing ? "bg-[#181818] text-white" : "bg-white text-[#74808C] hover:text-[#181818]"
                }`}
              >
                Finishing
              </button>
            </div>
          </div>
        )}

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

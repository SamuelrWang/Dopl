"use client";

import { useMemo, useRef, useState, type ReactNode } from "react";
import { apiRequest } from "@/shared/api/api-client";
import {
  AuthSplitLayout,
  BrandLockup,
  type AuthGlassPose,
  type GlassCardContent,
  type GlassCardContext,
} from "@/shared/layout/auth-split";
import { useMcpConnectionPoll } from "../hooks/use-mcp-connection-poll";
import type { OnboardingStep, SurveySubmission } from "../types";
import { LoginFormCore } from "@/features/auth/components/login-form-core";
import { McpConnectStep } from "./mcp-connect-step";
import { ConnectAgentShowcase, type ConnectAgentLogos } from "./connect-agent-showcase";
import { ProvisioningChecklist } from "./provisioning-checklist";
import { SoloTeamShowcase } from "./solo-team-showcase";
import { SurveyStep } from "./survey-step";
import { WorkspaceNameStep } from "./workspace-name-step";
import { BringAgentStep } from "./bring-agent-step";
import { AgentsShowcase } from "./agents-showcase";
import { WorkspaceTabsShowcase } from "./workspace-tabs-showcase";
import { LOGIN_CARD_KEY, loginGlassCard, type LoginJourneyImages } from "./login-journey-showcase";

/**
 * The banner glass panel's pose per step. The layout owns the motion; this is
 * only which of its poses the step wants, and going BACK a step reverses the
 * same animation for free.
 *
 * Step 3 ("Bring Your Agent") turns the panel on its side against the left
 * edge (Samuel 2026-10-13). Step 4 is `default` on purpose: the plain centred
 * rounded rect the panel has always been.
 */
const GLASS_POSE: Record<OnboardingStep, AuthGlassPose> = {
  survey: "lowered-top-notch",
  connect: "raised-bottom-notch",
  agents: "vertical-left-top-notch",
  workspace: "default",
};

/** Display number of each step, for "Step N of 4". */
const STEP_NUMBER: Record<OnboardingStep, number> = {
  survey: 1,
  connect: 2,
  agents: 3,
  workspace: 4,
};

/**
 * What the glass card shows, by pose. Keyed by POSE because the card's content
 * has to leave with the card (see `GlassCardContent`); step 1 is the only step
 * in `"lowered-top-notch"`, so this is step 1's showcase and nothing else's.
 * Its description line lives here now, not on the form (Samuel 2026-10-13).
 * Likewise step 2 alone is `"raised-bottom-notch"`: its agent-chat showcase;
 * and step 3 alone is `"vertical-left-top-notch"`.
 */
function glassCard(
  avatarSrc: string | undefined,
  teamAvatarSrcs: string[] | undefined,
  connectLogos: ConnectAgentLogos | undefined
): GlassCardContent {
  return {
    [GLASS_POSE.survey]: (ctx: GlassCardContext) => (
      <SoloTeamShowcase {...ctx} avatarSrc={avatarSrc} teamSrcs={teamAvatarSrcs} />
    ),
    [GLASS_POSE.connect]: (ctx: GlassCardContext) => (
      <ConnectAgentShowcase {...ctx} logos={connectLogos} />
    ),
    [GLASS_POSE.agents]: (ctx: GlassCardContext) => (
      <AgentsShowcase
        {...ctx}
        mark={connectLogos?.dopl}
        images={{
          you: avatarSrc,
          claude: connectLogos?.claude,
          chatgpt: connectLogos?.chatgpt,
          muse: connectLogos?.muse,
        }}
      />
    ),
    [GLASS_POSE.workspace]: (ctx: GlassCardContext) => (
      <WorkspaceTabsShowcase
        {...ctx}
        photos={[avatarSrc, ...(teamAvatarSrcs ?? [])].filter((s): s is string => !!s)}
        agentLogos={connectLogos}
      />
    ),
  };
}

interface FinishArgs {
  mcpConnected: boolean;
  name?: string;
  description?: string;
}

export interface OnboardingFlowCoreProps {
  initialStep: OnboardingStep;
  /** Deep-link passthrough; the server re-validates via safeRedirect. */
  redirectTo?: string;
  /** Fires with the server-chosen landing path. Router-agnostic: the mount
   *  navigates with its own router (the desktop SPA's hash router). */
  onDone: (redirectTo: string) => void;
  /** Brand mark beside the wordmark. ⚠ Must load from a `file://` document in
   *  the packaged SPA, where `/favicons/...` resolves to filesystem root: the
   *  SPA passes an inlined image. */
  brand?: ReactNode;
  /** Right-pane banner, passed through to `AuthSplitLayout`. Same `file://`
   *  problem as `brand`: packaged SPA hands a Vite-bundled asset URL, else the
   *  layout's `public/` default. Why the shared file can't import the image:
   *  `shared/layout/auth-split/auth-split-layout.tsx` › AuthSplitLayout. */
  bannerSrc?: string;
  /** Step 1's showcase: the photo in the middle of the agent web. Same
   *  `file://` problem as `brand` — the SPA passes an inlined image. Absent →
   *  a drawn placeholder. */
  avatarSrc?: string;
  /** Step 1's showcase, team beat: the two people beside `avatarSrc`. Same
   *  inlined-image rule; absent → drawn placeholders. */
  teamAvatarSrcs?: string[];
  /** Step 2's showcase: the agent icons (Claude, Gemini) and the Dopl mark on
   *  its tool rows. Same `file://` problem — the SPA passes inlined images.
   *  Absent → drawn letter fallbacks. */
  connectLogos?: ConnectAgentLogos;
  /** Step 3's "Sign in to ChatGPT" mark. Same inlined-image rule; absent →
   *  a text-only button. */
  chatgptLogo?: string;
  /** The preview Login page's card images (`./login-journey-showcase.tsx`).
   *  Same inlined-image rule; absent → drawn fallbacks. */
  loginImages?: LoginJourneyImages;
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
  /**
   * The glass opens where the login screen's left it (plain rect, the login card)
   * and slides into this step's pose — the sign-in → onboarding hand-off
   * (Samuel 2026-10-13). The real `/onboarding` page sets it; in preview the
   * "Login" page plays the same slide.
   */
  enterFromLogin?: boolean;
}

/**
 * Onboarding stepper core, Next-free (its one mount: the desktop SPA's
 * `/onboarding` page): survey → MCP connect → home-space naming, on the login
 * split layout.
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
  avatarSrc,
  teamAvatarSrcs,
  connectLogos,
  chatgptLogo,
  loginImages,
  previewOnly = false,
  enterFromLogin = false,
}: OnboardingFlowCoreProps) {
  const [step, setStep] = useState<OnboardingStep>(initialStep);
  const cardContent = useMemo(
    () => glassCard(avatarSrc, teamAvatarSrcs, connectLogos),
    [avatarSrc, teamAvatarSrcs, connectLogos]
  );
  const loginCard = useMemo(() => loginGlassCard(loginImages ?? {}), [loginImages]);
  /** Preview only: the login screen, shown on this same layout so leaving it
   *  plays the real glass hand-off. Starts there, since login comes first. */
  const [previewLogin, setPreviewLogin] = useState(previewOnly);
  const loginView = previewOnly && previewLogin;
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
      onDone(body.redirectTo);
    } catch {
      finishRef.current = false;
      setFinishing(false);
      setError("Couldn't set up your home space. Please try again.");
    }
  }

  const previewBar = previewOnly && (
    <div className="mb-5 rounded-[10px] border border-dashed border-[#c9c9c9] bg-[#f7f7f7] px-3.5 py-2.5">
      <p className="font-mono text-[10px] uppercase tracking-[0.12em] text-[#9a9a9a]">
        Preview, nothing is saved
      </p>
      <div className="mt-2 flex gap-1.5">
        {(["login", "survey", "connect", "agents", "workspace"] as const).map((s, i) => {
          const on = s === "login" ? loginView : !loginView && step === s && !finishing;
          return (
            <button
              key={s}
              type="button"
              onClick={() => {
                setFinishing(false);
                if (s === "login") {
                  setPreviewLogin(true);
                  return;
                }
                if (loginView) {
                  setStep(s);
                  setPreviewLogin(false);
                } else {
                  changeStep(s);
                }
              }}
              className={`cursor-pointer rounded-full px-3 py-1 text-[12px] font-medium transition-colors ${
                on ? "bg-[#181818] text-white" : "bg-white text-[#74808C] hover:text-[#181818]"
              }`}
            >
              {s === "login" ? "Login" : i}
            </button>
          );
        })}
        <button
          type="button"
          onClick={() => {
            setPreviewLogin(false);
            setFinishing(true);
          }}
          className={`cursor-pointer rounded-full px-3 py-1 text-[12px] font-medium transition-colors ${
            finishing && !loginView ? "bg-[#181818] text-white" : "bg-white text-[#74808C] hover:text-[#181818]"
          }`}
        >
          Finishing
        </button>
      </div>
    </div>
  );

  const lockup = brand ? <BrandLockup mark={brand} /> : undefined;

  /** Preview's stand-in for signing in: any sign-in path lands on step 1. */
  const previewSignIn = async () => {
    setFinishing(false);
    setStep("survey");
    setPreviewLogin(false);
    return {};
  };

  if (loginView) {
    return (
      <AuthSplitLayout
        bannerSrc={bannerSrc}
        cornerBrand={lockup}
        // The login card (Samuel 2026-10-13) — the same one the desktop
        // signed-out screen wears. Its own key: step 4 shares `"default"`.
        glassPose="default"
        glassCardKey={LOGIN_CARD_KEY}
        glassCardContent={loginCard}
      >
        {/* Centred like the signed-out screen: the form caps its own width
            but does not centre itself, so a stretched wrapper left-aligned it. */}
        <div className="flex w-full flex-col items-center">
          <div className="w-full max-w-[336px]">{previewBar}</div>
          <LoginFormCore
            actions={{
              signInWithPassword: previewSignIn,
              signUpWithPassword: previewSignIn,
              oauth: previewSignIn,
            }}
            defaultMode="signin"
          />
        </div>
      </AuthSplitLayout>
    );
  }

  return (
    <AuthSplitLayout
      bannerSrc={bannerSrc}
      glassPose={GLASS_POSE[step]}
      glassEnterFrom={enterFromLogin || previewOnly ? "default" : undefined}
      glassCardContent={cardContent}
      glassCardKey={step}
      cornerBrand={lockup}
    >
      <div className="w-full max-w-[360px]" style={{ animation: "loginFadeIn 0.6s ease-out both" }}>
        {previewBar}

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
          {/* Directly above each step's own heading (Samuel 2026-10-13); the
              lockup lives in the layout's corner now, not here. */}
          {!finishing && (
            <p className="mb-2 font-mono text-[11px] uppercase tracking-[0.12em] text-[#9a9a9a]">
              Step {STEP_NUMBER[step]} of 4
            </p>
          )}
          {finishing ? (
            <ProvisioningChecklist />
          ) : step === "survey" ? (
            <SurveyStep submitting={submitting} onSubmit={handleSurveySubmit} />
          ) : step === "connect" ? (
            <McpConnectStep
              connected={connected}
              finishing={finishing}
              onContinue={() => changeStep("agents")}
            />
          ) : step === "agents" ? (
            <BringAgentStep
              previewOnly={previewOnly}
              claudeLogo={connectLogos?.claude}
              chatgptLogo={chatgptLogo}
              museLogo={connectLogos?.muse}
              grokLogo={connectLogos?.grok}
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

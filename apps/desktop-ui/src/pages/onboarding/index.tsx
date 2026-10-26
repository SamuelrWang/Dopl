import { Navigate, useNavigate, useSearchParams } from "react-router";
import { OnboardingFlowCore } from "@/features/onboarding/components/onboarding-flow-core";
import { useApiQuery } from "#/hooks/use-api-query";
import { PageError, PageLoading, isUnauthorized } from "#/components/page-states";
import { LOGIN_IMAGES, SignedOutScreen } from "#/pages/boot/signed-out-screen";
import { ONBOARDING_STATE_PATH } from "#/pages/boot/use-boot-state";
// Same bundled banner the signed-out screen passes, same reason: shared layout's
// default is a web-only `public/` path (see that file).
import frameworkBanner from "#/assets/framework-banner.jpg";
// Same mark, same rounded app-icon treatment as the signed-out screen's lockup
// (`pages/boot/signed-out-screen.tsx`). `?inline` for the same reason it is
// there: a packaged `file://` document cannot fetch a hashed asset path.
import doplMark from "#/assets/dopl-mark.png?inline";
// The person at the centre of step 1's agent web. `?inline` for the same
// `file://` reason (~14KB, so the data URI is cheap).
import onboardingAvatar from "#/assets/onboarding-avatar.jpg?inline";
// Step 1's team beat: the two people beside the first. Same `?inline` reason.
import onboardingAvatar2 from "#/assets/onboarding-avatar-2.jpg?inline";
import onboardingAvatar3 from "#/assets/onboarding-avatar-3.jpg?inline";
// Step 2's agent icons (official marks, downloaded 2026-10-13). `?inline`, same
// `file://` reason; both are small SVGs.
import claudeLogo from "#/assets/claude-logo.svg?inline";
// Step 3's "Sign in to ChatGPT" mark (official logo, downloaded 2026-10-13
// with Samuel's OK). `?inline`, same `file://` reason.
import chatgptLogo from "#/assets/chatgpt-logo.svg?inline";
import geminiLogo from "#/assets/gemini-logo.svg?inline";
// Step 3's channel-chat avatars: the ChatGPT knot above, and the Meta Muse M.
import museLogo from "#/assets/muse-logo.svg?inline";
// Step 3's "Sign in to Grok" mark: xAI's current Grok symbol, cut from the
// Feb-2025 logo on Wikimedia Commons (public domain), downloaded 2026-10-13.
import grokLogo from "#/assets/grok-logo.svg?inline";

/** Steps 2–3's showcase images. Module-level so the flow's memo never churns. */
const CONNECT_LOGOS = {
  claude: claudeLogo,
  gemini: geminiLogo,
  dopl: doplMark,
  chatgpt: chatgptLogo,
  muse: museLogo,
  grok: grokLogo,
};
/** Step 1's team photos. Module-level for the same reason. */
const TEAM_AVATARS = [onboardingAvatar2, onboardingAvatar3];

/** The brand mark, left of the wordmark in the onboarding lockup. */
const BRAND_MARK = (
  // next/image forbidden — no Next runtime in this SPA.
  // eslint-disable-next-line @next/next/no-img-element
  <img src={doplMark} alt="" draggable={false} className="auth-logo-3d h-8 w-8 rounded-md" />
);

/**
 * /onboarding — first-run flow. ⚠ The one page OUTSIDE `/:workspaceSegment`:
 * runs before the user has a container, so it cannot mount under the shell.
 * ⚠ **AND A NEW USER NEVER GETS A STANDARD WORKSPACE AT ALL** (Samuel's ruling
 * R-35, 2026-09-17) — this page reads `GET /api/user/onboarding-state` and
 * nothing workspace-shaped, so it renders and completes with none in existence.
 *
 * - 401 → the SAME signed-out screen boot and the shell render; a generic error
 *   card here is a dead end whose Retry only 401s again.
 * - Already onboarded → `/`. `GET /api/user/onboarding-state` shares its key
 *   with boot, so a boot→onboarding hop pays once; the re-check only really
 *   fires on a direct landing at `#/onboarding`.
 * - No `redirectTo`: no deep-link entry into the SPA yet, so the server's own
 *   `redirectPath` always wins.
 *
 * `surveyCompleted` (same read) resumes a half-finished user at the connect
 * step instead of re-asking the survey.
 */
export default function OnboardingPage() {
  const navigate = useNavigate();
  const [search] = useSearchParams();
  const state = useApiQuery<{ isOnboarded: boolean; surveyCompleted?: boolean }>(
    ONBOARDING_STATE_PATH
  );

  /**
   * 🔒 `#/onboarding?preview=1` — COPY REVIEW ONLY, and only in a dev build:
   * `import.meta.env.DEV` is compile-time, so the packaged renderer cannot
   * reach this branch no matter what a URL says. It skips the already-onboarded
   * bounce below so these screens can be read by someone who finished
   * onboarding long ago, and hands the core `previewOnly`, which makes every
   * step render and WRITE NOTHING. No account state moves.
   */
  const preview = import.meta.env.DEV && search.get("preview") === "1";

  // Preview renders on its own: the state read below decides signed-out vs
  // bounce-to-home, and neither question applies when nothing is being
  // written. Skipping it means the screens come up in a plain browser tab too,
  // where this page has no session.
  if (preview) {
    return (
      <OnboardingFlowCore
        previewOnly
        initialStep="survey"
        brand={BRAND_MARK}
        bannerSrc={frameworkBanner}
        avatarSrc={onboardingAvatar}
        teamAvatarSrcs={TEAM_AVATARS}
        connectLogos={CONNECT_LOGOS}
        chatgptLogo={chatgptLogo}
        loginImages={LOGIN_IMAGES}
        onDone={() => {}}
      />
    );
  }

  // ⚠ Outside the workspace shell, so these render on the raw body — the dark
  // landing backdrop, where token text color is near-black on near-black. Pin
  // to the same light cover boot uses.
  if (state.isPending) {
    return (
      <div className="fixed inset-0 z-50 flex bg-white">
        <PageLoading label="Loading" />
      </div>
    );
  }
  if (isUnauthorized(state.error)) return <SignedOutScreen />;
  if (state.error) {
    return (
      <div className="fixed inset-0 z-50 flex bg-white">
        <PageError error={state.error} onRetry={() => void state.refetch()} />
      </div>
    );
  }
  // Already onboarded — the boot route resolves the caller's HOME SPACE (their
  // `kind='home'` container) and lands on /home. ⚠ NOT "the default
  // workspace": there is no derived default (INVARIANTS §4A, wave B B14).
  if (state.data?.isOnboarded) return <Navigate to="/" replace />;

  return (
    <OnboardingFlowCore
      initialStep={state.data?.surveyCompleted ? "connect" : "survey"}
      // Arrives from the signed-out screen (or boot): the glass opens where
      // login left it and slides into the first step's pose.
      enterFromLogin
      brand={BRAND_MARK}
      bannerSrc={frameworkBanner}
      avatarSrc={onboardingAvatar}
      teamAvatarSrcs={TEAM_AVATARS}
      connectLogos={CONNECT_LOGOS}
      chatgptLogo={chatgptLogo}
      // The server answers `/home` for a home space — a ROOT SPA route,
      // not `/{segment}/overview` (`onboarding/server/service.ts ›
      // completeOnboarding`). Either way it is a path the SPA already has.
      onDone={(to) => navigate(to, { replace: true })}
    />
  );
}

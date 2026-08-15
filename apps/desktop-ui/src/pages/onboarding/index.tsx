import { Navigate, useNavigate } from "react-router";
import { OnboardingFlowCore } from "@/features/onboarding/components/onboarding-flow-core";
import { useApiQuery } from "#/hooks/use-api-query";
import { PageError, PageLoading, isUnauthorized } from "#/components/page-states";
import { SignedOutScreen } from "#/pages/boot/signed-out-screen";
import { ONBOARDING_STATE_PATH } from "#/pages/boot/use-boot-state";
// Same bundled banner the signed-out screen passes, same reason: shared layout's
// default is a web-only `public/` path (see that file).
import frameworkBanner from "#/assets/framework-banner.jpg";

/**
 * /onboarding — first-run flow. ⚠ The one page OUTSIDE `/:workspaceSegment`:
 * runs before the user has a workspace, so it cannot mount under the shell.
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
  const state = useApiQuery<{ isOnboarded: boolean; surveyCompleted?: boolean }>(
    ONBOARDING_STATE_PATH
  );

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
  // Already onboarded — boot route resolves the default workspace.
  if (state.data?.isOnboarded) return <Navigate to="/" replace />;

  return (
    <OnboardingFlowCore
      initialStep={state.data?.surveyCompleted ? "connect" : "survey"}
      bannerSrc={frameworkBanner}
      // The server answers `/{segment}/overview` — already a valid SPA path.
      onDone={(to) => navigate(to, { replace: true })}
    />
  );
}

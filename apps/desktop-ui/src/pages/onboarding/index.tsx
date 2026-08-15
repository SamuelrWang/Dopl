import { Navigate, useNavigate } from "react-router";
import { OnboardingFlowCore } from "@/features/onboarding/components/onboarding-flow-core";
import { useApiQuery } from "#/hooks/use-api-query";
import { PageError, PageLoading, isUnauthorized } from "#/components/page-states";
import { SignedOutScreen } from "#/pages/boot/signed-out-screen";
import { ONBOARDING_STATE_PATH } from "#/pages/boot/use-boot-state";
// Same bundled banner the signed-out screen passes, for the same reason: the
// shared layout's default is a web-only `public/` path (see that file).
import frameworkBanner from "#/assets/framework-banner.jpg";

/**
 * /onboarding — first-run flow for new signups. Port of
 * `src/app/onboarding/page.tsx` (docs/migration-research/journey-audit.md J1
 * step 8), and the one ported page that lives OUTSIDE `/:workspaceSegment`:
 * it runs before the user has a workspace to be in, so it cannot mount under
 * the workspace shell.
 *
 * Samuel's directive for the desktop migration is that new users onboard IN the
 * app; the web `/onboarding` RSC dies with the website (Phase 4).
 *
 * The RSC did three things this file replaces:
 *   1. `getUser()` + redirect to `/login` — the SPA has no login route, so a
 *      401 renders the SAME signed-out screen boot and the shell render
 *      (a generic error card here was a dead end whose Retry only 401s again).
 *   2. `getOnboardingStatus` + redirect to `/canvas` when already onboarded —
 *      `GET /api/user/onboarding-state` is the HTTP twin. The boot page reads
 *      the SAME key, so a normal boot→onboarding hop pays for it once; this
 *      re-check only really fires when someone lands on `#/onboarding` directly.
 *   3. `safeRedirect(searchParams.redirectTo)` — there is no deep-link entry
 *      into the SPA yet (no `dopl://invite`, journey-audit GAP-4), so no
 *      redirectTo is passed and the server's own `redirectPath` always wins.
 *
 * `initialStep` is always "survey": `/api/user/onboarding-state` answers
 * both `isOnboarded` and `surveyCompleted` (same pair the RSC read via
 * `getOnboardingStatus`), so a half-finished user RESUMES at the connect
 * step instead of re-answering the survey.
 */
export default function OnboardingPage() {
  const navigate = useNavigate();
  const state = useApiQuery<{ isOnboarded: boolean; surveyCompleted?: boolean }>(
    ONBOARDING_STATE_PATH
  );

  // This route lives OUTSIDE the workspace shell, so these states render on
  // the raw body — the dark landing backdrop, where the token text color is
  // near-black on near-black. Pin them to the same light cover boot uses.
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
  // Already onboarded — the boot route resolves the default workspace, the same
  // hop the RSC made to `/canvas`.
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

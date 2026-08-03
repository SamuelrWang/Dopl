import { Navigate, useNavigate } from "react-router";
import { OnboardingFlowCore } from "@/features/onboarding/components/onboarding-flow-core";
import { useApiQuery } from "#/hooks/use-api-query";
import { PageError, PageLoading } from "#/components/page-states";
import { ONBOARDING_STATE_PATH } from "#/pages/boot/use-boot-state";

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
 *   1. `getUser()` + redirect to `/login` — the SPA has no login route; an
 *      unauthenticated caller is caught one level up, by the boot page, which
 *      owns the signed-out screen.
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

  if (state.isPending) return <PageLoading label="Loading" />;
  if (state.error) {
    return <PageError error={state.error} onRetry={() => void state.refetch()} />;
  }
  // Already onboarded — the boot route resolves the default workspace, the same
  // hop the RSC made to `/canvas`.
  if (state.data?.isOnboarded) return <Navigate to="/" replace />;

  return (
    <OnboardingFlowCore
      initialStep={state.data?.surveyCompleted ? "connect" : "survey"}
      // The server answers `/{segment}/overview` — already a valid SPA path.
      onDone={(to) => navigate(to, { replace: true })}
    />
  );
}

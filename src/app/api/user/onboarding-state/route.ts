import { NextResponse } from "next/server";
import { withUserAuth } from "@/shared/auth/with-auth";
import { getOnboardingStatus } from "@/features/onboarding/server/service";
import { toHttpErrorResponse } from "@/shared/api/http-error-response";

export const dynamic = "force-dynamic";

/**
 * GET /api/user/onboarding-state — has the caller finished onboarding?
 * Reads `profiles.onboarded_at` (via `isOnboarded`), which is the same
 * gate `src/app/auth/callback/route.ts` applies before redirecting to
 * `/onboarding`. (It used to name two RSC boot pages beside it; both left
 * with the web app.) The SPA's launch sequence needs it over HTTP.
 *
 * NOT the same question as `GET /api/onboarding/mcp-status` — that one
 * asks whether an agent has connected over MCP, which a user can skip
 * and still be onboarded.
 */
export const GET = withUserAuth(async (_request, { userId }) => {
  try {
    // `surveyCompleted` rides along so the SPA's onboarding flow can
    // RESUME a half-finished user at the workspace step instead of
    // re-asking the survey — the same pair the RSC boot pages read via
    // getOnboardingStatus.
    const status = await getOnboardingStatus(userId);
    return NextResponse.json({
      isOnboarded: status.onboarded,
      surveyCompleted: status.surveyCompleted,
    });
  } catch (err) {
    return toHttpErrorResponse("api/user/onboarding-state", err);
  }
});

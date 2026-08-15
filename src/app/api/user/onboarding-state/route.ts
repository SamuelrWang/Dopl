import { NextResponse } from "next/server";
import { withUserAuth } from "@/shared/auth/with-auth";
import { getOnboardingStatus } from "@/features/onboarding/server/service";
import { toHttpErrorResponse } from "@/shared/api/http-error-response";

export const dynamic = "force-dynamic";

/**
 * GET — has the caller finished onboarding? Reads `profiles.onboarded_at` via `isOnboarded`;
 * the SPA's launch sequence needs it over HTTP.
 * ⚠ NOT the same question as `GET /api/onboarding/mcp-status`, which asks whether an agent has
 * connected over MCP — a user can skip that and still be onboarded.
 */
export const GET = withUserAuth(async (_request, { userId }) => {
  try {
    // `surveyCompleted` lets the SPA RESUME a half-finished user at the workspace step instead
    // of re-asking the survey.
    const status = await getOnboardingStatus(userId);
    return NextResponse.json({
      isOnboarded: status.onboarded,
      surveyCompleted: status.surveyCompleted,
    });
  } catch (err) {
    return toHttpErrorResponse("api/user/onboarding-state", err);
  }
});

import { NextResponse } from "next/server";
import { withUserAuth } from "@/shared/auth/with-auth";
import { HttpError } from "@/shared/lib/http-error";
import { getOnboardingStatus } from "@/features/onboarding/server/service";

export const dynamic = "force-dynamic";

/**
 * GET /api/user/onboarding-state — has the caller finished onboarding?
 * Reads `profiles.onboarded_at` (via `isOnboarded`), which is the same
 * gate the RSC boot pages use before redirecting to `/onboarding`
 * (`src/app/[workspaceSlug]/(app)/page.tsx`, `src/app/canvas/page.tsx`,
 * `src/app/auth/callback/route.ts`). The SPA's launch sequence needs it
 * over HTTP.
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
    if (err instanceof HttpError) {
      return NextResponse.json(err.toResponseBody(), { status: err.status });
    }
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json(
      { error: { code: "INTERNAL_ERROR", message } },
      { status: 500 }
    );
  }
});

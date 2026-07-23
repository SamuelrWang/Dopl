import { NextRequest, NextResponse } from "next/server";
import { withUserAuth } from "@/shared/auth/with-auth";
import { parseJson } from "@/shared/api/parse-json";
import { HttpError } from "@/shared/lib/http-error";
import { safeRedirect } from "@/shared/lib/url/safe-redirect";
import { CompleteOnboardingSchema } from "@/features/onboarding/schema";
import { completeOnboarding } from "@/features/onboarding/server/service";

/**
 * POST /api/onboarding/complete — name the default workspace after the
 * user, stamp onboarded_at, and return where to land. An explicit
 * deep-link redirectTo (invite URLs etc.) wins over the workspace path,
 * after the usual open-redirect guard.
 */
export const POST = withUserAuth(async (request: NextRequest, { userId }) => {
  try {
    const input = await parseJson(request, CompleteOnboardingSchema);
    const result = await completeOnboarding(userId, {
      mcpConnected: input.mcpConnected,
      name: input.name,
      description: input.description,
    });
    const redirectTo = safeRedirect(input.redirectTo, result.redirectPath);
    return NextResponse.json({ redirectTo });
  } catch (err) {
    if (err instanceof HttpError) {
      return NextResponse.json(err.toResponseBody(), { status: err.status });
    }
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
});

import { NextRequest, NextResponse } from "next/server";
import { withUserAuth } from "@/shared/auth/with-auth";
import { parseJson } from "@/shared/api/parse-json";
import { safeRedirect } from "@/shared/lib/url/safe-redirect";
import { CompleteOnboardingSchema } from "@/features/onboarding/schema";
import { completeOnboarding } from "@/features/onboarding/server/service";
import { toHttpErrorResponse } from "@/shared/api/http-error-response";

/** POST — name the default workspace after the user, stamp onboarded_at, return where to land.
 *  An explicit `redirectTo` wins over the workspace path, after the open-redirect guard. */
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
    return toHttpErrorResponse("api/onboarding/complete", err);
  }
});

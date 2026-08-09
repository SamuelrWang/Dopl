import { NextRequest, NextResponse } from "next/server";
import { withUserAuth } from "@/shared/auth/with-auth";
import { parseJson } from "@/shared/api/parse-json";
import { SurveySubmissionSchema } from "@/features/onboarding/schema";
import { submitSurvey } from "@/features/onboarding/server/service";
import { toHttpErrorResponse } from "@/shared/api/http-error-response";

/**
 * POST /api/onboarding/survey — record the onboarding survey answers as
 * a conversion event. Idempotent per user (first submission wins).
 */
export const POST = withUserAuth(async (request: NextRequest, { userId }) => {
  try {
    const input = await parseJson(request, SurveySubmissionSchema);
    await submitSurvey(userId, input);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return toHttpErrorResponse("api/onboarding/survey", err);
  }
});

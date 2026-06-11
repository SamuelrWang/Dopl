import { NextRequest, NextResponse } from "next/server";
import { withUserAuth } from "@/shared/auth/with-auth";
import { parseJson } from "@/shared/api/parse-json";
import { HttpError } from "@/shared/lib/http-error";
import { SurveySubmissionSchema } from "@/features/onboarding/schema";
import { submitSurvey } from "@/features/onboarding/server/service";

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
    if (err instanceof HttpError) {
      return NextResponse.json(err.toResponseBody(), { status: err.status });
    }
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
});

import { NextRequest, NextResponse } from "next/server";
import { withUserAuth } from "@/shared/auth/with-auth";
import { toHttpErrorResponse } from "@/shared/api/http-error-response";
import { getHomePreview } from "@/features/home/server/service-preview";

interface Ctx {
  userId: string;
}

const SOURCE = "api/home/preview";

/** GET — the caller's own seeded preview payloads (`account_preview_data`); takes no parameters. */
export const GET = withUserAuth(async (_request: NextRequest, { userId }: Ctx) => {
  try {
    const preview = await getHomePreview(userId);
    return NextResponse.json(preview, { headers: { "Cache-Control": "private, no-store" } });
  } catch (err) {
    return toHttpErrorResponse(SOURCE, err);
  }
});

import { NextRequest, NextResponse } from "next/server";
import { toHttpErrorResponse } from "@/shared/api/http-error-response";
import { getLinkPublicInfo } from "@/features/home/server/service-reads";

/**
 * GET — what the `/link/[token]` page may show BEFORE the visitor signs in.
 *
 * 🔒 ⚠ DELIBERATELY UNAUTHENTICATED (listed in `public-routes.ts ›
 * PUBLIC_ROUTES`): the visitor has no account yet, so the token's
 * unguessability is the fence. Payload is narrowed to a display name and three
 * booleans — never the creator's email or id (`service-reads.ts ›
 * getLinkPublicInfo`).
 *
 * ⚠ `/api/home/link/` (singular), not a sibling of `/links/[linkId]`: Next.js
 * forbids two slug names at one level, and it keeps the public prefix off the
 * authenticated half.
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ token: string }> }
) {
  try {
    const { token } = await params;
    return NextResponse.json(await getLinkPublicInfo(token), {
      headers: { "Cache-Control": "private, no-store" },
    });
  } catch (err) {
    return toHttpErrorResponse("api/home/link/[token]/info", err);
  }
}

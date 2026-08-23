import { NextRequest, NextResponse } from "next/server";
import { withUserAuth } from "@/shared/auth/with-auth";
import { toHttpErrorResponse } from "@/shared/api/http-error-response";
import { getHomeRelationships } from "@/features/home/server/service-reads";

interface Ctx {
  userId: string;
}

/**
 * GET — the home page in one round trip: the caller's claimed relationships and
 * their own pending links (`HomeRelationshipsPayload`).
 *
 * ⚠ NOT workspace-scoped, so `withUserAuth` and no `X-Workspace-Id`. The fence
 * is the caller's own membership rows — a link container the caller does not
 * belong to is not reachable from any query here.
 */
export const GET = withUserAuth(async (_request: NextRequest, { userId }: Ctx) => {
  try {
    return NextResponse.json(await getHomeRelationships(userId), {
      headers: { "Cache-Control": "private, no-store" },
    });
  } catch (err) {
    return toHttpErrorResponse("api/home/relationships", err);
  }
});

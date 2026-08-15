import { NextRequest, NextResponse } from "next/server";
import { withUserAuth } from "@/shared/auth/with-auth";
import { listMyJoinNotices } from "@/features/workspaces/server/join-links";
import { toHttpErrorResponse } from "@/shared/api/http-error-response";

interface Ctx {
  userId: string;
}

/** GET — the caller's unacknowledged join-request notices (awaiting + approved/declined),
 *  driving the one-time popups in the app layout. */
export const GET = withUserAuth(async (_request: NextRequest, { userId }: Ctx) => {
  try {
    const notices = await listMyJoinNotices(userId);
    return NextResponse.json(
      { notices },
      { headers: { "Cache-Control": "private, no-store" } }
    );
  } catch (err) {
    return toHttpErrorResponse("api/me/join-requests", err);
  }
});

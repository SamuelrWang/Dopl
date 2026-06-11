import { NextRequest, NextResponse } from "next/server";
import { withUserAuth } from "@/shared/auth/with-auth";
import { HttpError } from "@/shared/lib/http-error";
import { listMyJoinNotices } from "@/features/workspaces/server/join-links";

interface Ctx {
  userId: string;
}

/**
 * GET /api/me/join-requests — the caller's unacknowledged join-request
 * notices (awaiting-approval + approved/declined outcomes). Drives the
 * one-time popups mounted in the app layout.
 */
export const GET = withUserAuth(async (_request: NextRequest, { userId }: Ctx) => {
  try {
    const notices = await listMyJoinNotices(userId);
    return NextResponse.json(
      { notices },
      { headers: { "Cache-Control": "private, no-store" } }
    );
  } catch (err) {
    if (err instanceof HttpError) {
      return NextResponse.json(err.toResponseBody(), { status: err.status });
    }
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
});

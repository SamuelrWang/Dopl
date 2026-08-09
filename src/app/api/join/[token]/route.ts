import { NextRequest, NextResponse } from "next/server";
import { withUserAuth } from "@/shared/auth/with-auth";
import { requestJoin } from "@/features/workspaces/server/join-links";
import { toHttpErrorResponse } from "@/shared/api/http-error-response";

interface Ctx {
  userId: string;
  params?: Record<string, string>;
}

/**
 * POST /api/join/[token] — request to join the workspace behind a
 * shareable link. Authed. Returns either the workspace route (already a
 * member) or the requested/pending outcome for the awaiting-approval UX.
 */
export const POST = withUserAuth(
  async (_request: NextRequest, { userId, params }: Ctx) => {
    try {
      const token = params?.token;
      if (!token) {
        return NextResponse.json({ error: "token required" }, { status: 400 });
      }
      const result = await requestJoin(token, userId);
      return NextResponse.json(result);
    } catch (err) {
      return toHttpErrorResponse("api/join/[token]", err);
    }
  }
);

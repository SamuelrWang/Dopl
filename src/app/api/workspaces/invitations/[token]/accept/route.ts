import { NextRequest, NextResponse } from "next/server";
import { withUserAuth } from "@/shared/auth/with-auth";
import { acceptInvitationByToken } from "@/features/workspaces/server/invitations";
import { toHttpErrorResponse } from "@/shared/api/http-error-response";

interface Ctx {
  userId: string;
  params?: Record<string, string>;
}

/**
 * POST /api/workspaces/invitations/[token]/accept — accept an invitation.
 * The caller must be authenticated; their identity becomes the new
 * workspace member.
 */
export const POST = withUserAuth(
  async (_request: NextRequest, { userId, params }: Ctx) => {
    try {
      const token = params?.token;
      if (!token) {
        return NextResponse.json({ error: "token required" }, { status: 400 });
      }
      const result = await acceptInvitationByToken(token, userId);
      return NextResponse.json(result);
    } catch (err) {
      return toHttpErrorResponse("api/workspaces/invitations/[token]/accept", err);
    }
  }
);

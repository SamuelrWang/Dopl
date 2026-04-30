import { NextRequest, NextResponse } from "next/server";
import { withUserAuth } from "@/shared/auth/with-auth";
import { HttpError } from "@/shared/lib/http-error";
import { acceptInvitationByToken } from "@/features/canvases/server/invitations";

interface Ctx {
  userId: string;
  params?: Record<string, string>;
}

/**
 * POST /api/canvases/invitations/[token]/accept — accept an invitation.
 * The caller must be authenticated; their identity becomes the new
 * canvas member.
 */
export const POST = withUserAuth(
  async (_request: NextRequest, { userId, params }: Ctx) => {
    try {
      const token = params?.token;
      if (!token) {
        return NextResponse.json({ error: "token required" }, { status: 400 });
      }
      const { canvasSlug } = await acceptInvitationByToken(token, userId);
      return NextResponse.json({ canvasSlug });
    } catch (err) {
      if (err instanceof HttpError) {
        return NextResponse.json(err.toResponseBody(), { status: err.status });
      }
      const message = err instanceof Error ? err.message : "Unknown error";
      return NextResponse.json({ error: message }, { status: 500 });
    }
  }
);

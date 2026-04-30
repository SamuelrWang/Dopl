import { NextRequest, NextResponse } from "next/server";
import { withUserAuth } from "@/shared/auth/with-auth";
import { HttpError } from "@/shared/lib/http-error";
import { revokeInvitation } from "@/features/canvases/server/invitations";

interface Ctx {
  userId: string;
  params?: Record<string, string>;
}

/**
 * DELETE /api/canvases/[slug]/invitations/[id] — revoke a pending
 * invitation. Admin+ only (enforced inside `revokeInvitation` via the
 * canvas membership lookup it does for the invitation's canvas_id).
 */
export const DELETE = withUserAuth(
  async (_request: NextRequest, { userId, params }: Ctx) => {
    try {
      const id = params?.id;
      if (!id) {
        return NextResponse.json({ error: "invitation id required" }, { status: 400 });
      }
      await revokeInvitation(id, userId);
      return new NextResponse(null, { status: 204 });
    } catch (err) {
      if (err instanceof HttpError) {
        return NextResponse.json(err.toResponseBody(), { status: err.status });
      }
      const message = err instanceof Error ? err.message : "Unknown error";
      return NextResponse.json({ error: message }, { status: 500 });
    }
  }
);

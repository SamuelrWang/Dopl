import { NextRequest, NextResponse } from "next/server";
import { withUserAuth } from "@/shared/auth/with-auth";
import { revokeInvitation } from "@/features/workspaces/server/invitations";
import { toHttpErrorResponse } from "@/shared/api/http-error-response";

interface Ctx {
  userId: string;
  params?: Record<string, string>;
}

/** DELETE — revoke a pending invitation. Admin+, enforced inside `revokeInvitation`. */
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
      return toHttpErrorResponse("api/workspaces/[workspaceSlug]/invitations/[id]", err);
    }
  },
  // sessionOnly: admin action, not an agent one.
  { sessionOnly: true }
);

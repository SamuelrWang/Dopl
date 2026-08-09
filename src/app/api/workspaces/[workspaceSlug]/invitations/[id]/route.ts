import { NextRequest, NextResponse } from "next/server";
import { withUserAuth } from "@/shared/auth/with-auth";
import { revokeInvitation } from "@/features/workspaces/server/invitations";
import { toHttpErrorResponse } from "@/shared/api/http-error-response";

interface Ctx {
  userId: string;
  params?: Record<string, string>;
}

/**
 * DELETE /api/workspaces/[workspaceSlug]/invitations/[id] — revoke a pending
 * invitation. Admin+ only (enforced inside `revokeInvitation` via the
 * workspace membership lookup it does for the invitation's workspace_id).
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
      return toHttpErrorResponse("api/workspaces/[workspaceSlug]/invitations/[id]", err);
    }
  },
  // sessionOnly: revoking an invitation is an admin action, not an agent one.
  { sessionOnly: true }
);

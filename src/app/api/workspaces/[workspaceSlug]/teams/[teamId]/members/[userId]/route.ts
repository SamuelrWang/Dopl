import { NextRequest, NextResponse } from "next/server";
import { withUserAuth } from "@/shared/auth/with-auth";
import { resolveApiWorkspace } from "@/features/workspaces/server/segment";
import { removeTeamMember } from "@/features/teams/server/service";
import { toHttpErrorResponse } from "@/shared/api/http-error-response";

interface Ctx {
  userId: string;
  params?: Record<string, string>;
}

/** DELETE — remove from team. Admin+. */
export const DELETE = withUserAuth(
  async (_request: NextRequest, { userId, params }: Ctx) => {
    try {
      const workspace = await resolveApiWorkspace(params?.workspaceSlug ?? "", userId);
      const targetUserId = params?.userId;
      if (!workspace || !params?.teamId || !targetUserId) {
        return NextResponse.json({ error: "Workspace not found" }, { status: 404 });
      }
      await removeTeamMember(workspace.id, userId, params.teamId, targetUserId);
      return new NextResponse(null, { status: 204 });
    } catch (err) {
      return toHttpErrorResponse("api/workspaces/[workspaceSlug]/teams/[teamId]/members/[userId]", err);
    }
  },
  // sessionOnly: an access-control action, same class as a role change.
  { sessionOnly: true }
);

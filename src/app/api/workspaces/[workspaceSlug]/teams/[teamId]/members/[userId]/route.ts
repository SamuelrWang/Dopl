import { NextRequest, NextResponse } from "next/server";
import { withUserAuth } from "@/shared/auth/with-auth";
import { HttpError } from "@/shared/lib/http-error";
import { resolveApiWorkspace } from "@/features/workspaces/server/segment";
import { removeTeamMember } from "@/features/teams/server/service";

interface Ctx {
  userId: string;
  params?: Record<string, string>;
}

/** DELETE /api/workspaces/[workspaceSlug]/teams/[teamId]/members/[userId] — remove from team. Admin+ only. */
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
      if (err instanceof HttpError) {
        return NextResponse.json(err.toResponseBody(), { status: err.status });
      }
      const message = err instanceof Error ? err.message : "Unknown error";
      return NextResponse.json({ error: message }, { status: 500 });
    }
  }
);

import { NextRequest, NextResponse } from "next/server";
import { withUserAuth } from "@/shared/auth/with-auth";
import { parseJson } from "@/shared/api/parse-json";
import { HttpError } from "@/shared/lib/http-error";
import { resolveApiWorkspace } from "@/features/workspaces/server/segment";
import { TeamMembersAddSchema } from "@/features/teams/schema";
import { addTeamMembers } from "@/features/teams/server/service";

interface Ctx {
  userId: string;
  params?: Record<string, string>;
}

/** POST /api/workspaces/[workspaceSlug]/teams/[teamId]/members — add members. Admin+ only. */
export const POST = withUserAuth(
  async (request: NextRequest, { userId, params }: Ctx) => {
    try {
      const workspace = await resolveApiWorkspace(params?.workspaceSlug ?? "", userId);
      if (!workspace || !params?.teamId) {
        return NextResponse.json({ error: "Workspace not found" }, { status: 404 });
      }
      const { userIds } = await parseJson(request, TeamMembersAddSchema);
      await addTeamMembers(workspace.id, userId, params.teamId, userIds);
      return NextResponse.json({ ok: true });
    } catch (err) {
      if (err instanceof HttpError) {
        return NextResponse.json(err.toResponseBody(), { status: err.status });
      }
      const message = err instanceof Error ? err.message : "Unknown error";
      return NextResponse.json({ error: message }, { status: 500 });
    }
  }
);

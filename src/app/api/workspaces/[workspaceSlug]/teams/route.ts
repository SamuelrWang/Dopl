import { NextRequest, NextResponse } from "next/server";
import { withUserAuth } from "@/shared/auth/with-auth";
import { parseJson } from "@/shared/api/parse-json";
import { resolveApiWorkspace } from "@/features/workspaces/server/segment";
import { TeamCreateSchema } from "@/features/teams/schema";
import { createTeam, listTeams } from "@/features/teams/server/service";
import { toHttpErrorResponse } from "@/shared/api/http-error-response";

interface Ctx {
  userId: string;
  params?: Record<string, string>;
}

/** GET /api/workspaces/[workspaceSlug]/teams — list teams with members + grants. Any active member. */
export const GET = withUserAuth(
  async (_request: NextRequest, { userId, params }: Ctx) => {
    try {
      const workspace = await resolveApiWorkspace(params?.workspaceSlug ?? "", userId);
      if (!workspace) {
        return NextResponse.json({ error: "Workspace not found" }, { status: 404 });
      }
      const teams = await listTeams(workspace.id, userId);
      return NextResponse.json({ teams });
    } catch (err) {
      return toErrorResponse(err);
    }
  }
);

/** POST /api/workspaces/[workspaceSlug]/teams — create a team. Admin+ only. */
export const POST = withUserAuth(
  async (request: NextRequest, { userId, params }: Ctx) => {
    try {
      const workspace = await resolveApiWorkspace(params?.workspaceSlug ?? "", userId);
      if (!workspace) {
        return NextResponse.json({ error: "Workspace not found" }, { status: 404 });
      }
      const input = await parseJson(request, TeamCreateSchema);
      const team = await createTeam(workspace.id, userId, input);
      return NextResponse.json({ team }, { status: 201 });
    } catch (err) {
      return toErrorResponse(err);
    }
  }
);

function toErrorResponse(err: unknown): NextResponse {
  return toHttpErrorResponse("api/workspaces/[workspaceSlug]/teams", err);
}

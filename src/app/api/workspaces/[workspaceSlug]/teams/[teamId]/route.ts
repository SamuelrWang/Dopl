import { NextRequest, NextResponse } from "next/server";
import { withUserAuth } from "@/shared/auth/with-auth";
import { parseJson } from "@/shared/api/parse-json";
import { HttpError } from "@/shared/lib/http-error";
import { resolveApiWorkspace } from "@/features/workspaces/server/segment";
import { TeamUpdateSchema } from "@/features/teams/schema";
import { deleteTeam, getTeam, updateTeam } from "@/features/teams/server/service";

interface Ctx {
  userId: string;
  params?: Record<string, string>;
}

/** GET /api/workspaces/[workspaceSlug]/teams/[teamId] — team detail. Any active member. */
export const GET = withUserAuth(
  async (_request: NextRequest, { userId, params }: Ctx) => {
    try {
      const workspace = await resolveApiWorkspace(params?.workspaceSlug ?? "", userId);
      if (!workspace || !params?.teamId) {
        return NextResponse.json({ error: "Workspace not found" }, { status: 404 });
      }
      const team = await getTeam(workspace.id, userId, params.teamId);
      return NextResponse.json({ team });
    } catch (err) {
      return toErrorResponse(err);
    }
  }
);

/** PATCH /api/workspaces/[workspaceSlug]/teams/[teamId] — rename/recolor. Admin+ only. */
export const PATCH = withUserAuth(
  async (request: NextRequest, { userId, params }: Ctx) => {
    try {
      const workspace = await resolveApiWorkspace(params?.workspaceSlug ?? "", userId);
      if (!workspace || !params?.teamId) {
        return NextResponse.json({ error: "Workspace not found" }, { status: 404 });
      }
      const patch = await parseJson(request, TeamUpdateSchema);
      const team = await updateTeam(workspace.id, userId, params.teamId, patch);
      return NextResponse.json({ team });
    } catch (err) {
      return toErrorResponse(err);
    }
  }
);

/** DELETE /api/workspaces/[workspaceSlug]/teams/[teamId] — delete team. Admin+ only. */
export const DELETE = withUserAuth(
  async (_request: NextRequest, { userId, params }: Ctx) => {
    try {
      const workspace = await resolveApiWorkspace(params?.workspaceSlug ?? "", userId);
      if (!workspace || !params?.teamId) {
        return NextResponse.json({ error: "Workspace not found" }, { status: 404 });
      }
      await deleteTeam(workspace.id, userId, params.teamId);
      return new NextResponse(null, { status: 204 });
    } catch (err) {
      return toErrorResponse(err);
    }
  }
);

function toErrorResponse(err: unknown): NextResponse {
  if (err instanceof HttpError) {
    return NextResponse.json(err.toResponseBody(), { status: err.status });
  }
  const message = err instanceof Error ? err.message : "Unknown error";
  return NextResponse.json({ error: message }, { status: 500 });
}

import { NextRequest, NextResponse } from "next/server";
import { withUserAuth } from "@/shared/auth/with-auth";
import { parseJson } from "@/shared/api/parse-json";
import { resolveApiWorkspace } from "@/features/workspaces/server/segment";
import { TeamGrantSetSchema } from "@/features/teams/schema";
import { toHttpErrorResponse } from "@/shared/api/http-error-response";
import {
  getTeam,
  removeTeamGrant,
  setTeamGrant,
} from "@/features/teams/server/service";

interface Ctx {
  userId: string;
  /** The credential's container lock, threaded into the resolver (§4). */
  apiKeyWorkspaceId?: string | null;
  params?: Record<string, string>;
}

/** GET — a team's grants. Any active member. */
export const GET = withUserAuth(
  async (_request: NextRequest, { userId, apiKeyWorkspaceId, params }: Ctx) => {
    try {
      const workspace = await resolveApiWorkspace(params?.workspaceSlug ?? "", userId, { apiKeyWorkspaceId });
      if (!workspace || !params?.teamId) {
        return NextResponse.json({ error: "Workspace not found" }, { status: 404 });
      }
      const team = await getTeam(workspace.id, userId, params.teamId);
      return NextResponse.json({ grants: team.grants });
    } catch (err) {
      return toErrorResponse(err);
    }
  }
);

/** PUT — set or remove one grant; `level: null` removes. Admin+. */
export const PUT = withUserAuth(
  async (request: NextRequest, { userId, apiKeyWorkspaceId, params }: Ctx) => {
    try {
      const workspace = await resolveApiWorkspace(params?.workspaceSlug ?? "", userId, { apiKeyWorkspaceId });
      if (!workspace || !params?.teamId) {
        return NextResponse.json({ error: "Workspace not found" }, { status: 404 });
      }
      const input = await parseJson(request, TeamGrantSetSchema);
      if (input.level === null) {
        await removeTeamGrant(
          workspace.id,
          userId,
          params.teamId,
          input.resourceType,
          input.resourceId
        );
      } else {
        await setTeamGrant(
          workspace.id,
          userId,
          params.teamId,
          input.resourceType,
          input.resourceId,
          input.level
        );
      }
      return NextResponse.json({ ok: true });
    } catch (err) {
      return toErrorResponse(err);
    }
  },
  // sessionOnly: an access-control mutation, same class as a role change.
  { sessionOnly: true }
);

function toErrorResponse(err: unknown): NextResponse {
  return toHttpErrorResponse("api/workspaces/[workspaceSlug]/teams/[teamId]/access", err);
}

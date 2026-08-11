import { NextRequest, NextResponse } from "next/server";
import { withUserAuth } from "@/shared/auth/with-auth";
import { parseJson } from "@/shared/api/parse-json";
import { resolveApiWorkspace } from "@/features/workspaces/server/segment";
import { AccessModeSetSchema } from "@/features/teams/schema";
import { toHttpErrorResponse } from "@/shared/api/http-error-response";
import {
  getAccessMatrix,
  setResourceAccessMode,
} from "@/features/teams/server/service";

interface Ctx {
  userId: string;
  params?: Record<string, string>;
}

/**
 * GET /api/workspaces/[workspaceSlug]/access-matrix — teams + all KB/skill
 * resources with their access modes, for the Access tab. Any active member.
 */
export const GET = withUserAuth(
  async (_request: NextRequest, { userId, params }: Ctx) => {
    try {
      const workspace = await resolveApiWorkspace(params?.workspaceSlug ?? "", userId);
      if (!workspace) {
        return NextResponse.json({ error: "Workspace not found" }, { status: 404 });
      }
      const matrix = await getAccessMatrix(workspace.id, userId);
      return NextResponse.json(matrix);
    } catch (err) {
      return toErrorResponse(err);
    }
  }
);

/**
 * PUT /api/workspaces/[workspaceSlug]/access-matrix — flip a resource between
 * workspace-wide and teams-scoped access. Admin+ only.
 */
export const PUT = withUserAuth(
  async (request: NextRequest, { userId, params }: Ctx) => {
    try {
      const workspace = await resolveApiWorkspace(params?.workspaceSlug ?? "", userId);
      if (!workspace) {
        return NextResponse.json({ error: "Workspace not found" }, { status: 404 });
      }
      const input = await parseJson(request, AccessModeSetSchema);
      await setResourceAccessMode(
        workspace.id,
        userId,
        input.resourceType,
        input.resourceId,
        input.accessMode
      );
      return NextResponse.json({ ok: true });
    } catch (err) {
      return toErrorResponse(err);
    }
  },
  // sessionOnly: flipping resource access scope is an admin access-control
  // mutation, not an agent one — same class as changing a member's role.
  { sessionOnly: true }
);

function toErrorResponse(err: unknown): NextResponse {
  return toHttpErrorResponse("api/workspaces/[workspaceSlug]/access-matrix", err);
}

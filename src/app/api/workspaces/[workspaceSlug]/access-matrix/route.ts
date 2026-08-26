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
  /** The credential's container lock, threaded into the resolver (§4). */
  apiKeyWorkspaceId?: string | null;
  params?: Record<string, string>;
}

/** GET — teams + all KB/skill resources with their access modes, for the Access tab.
 *  Any active member. */
export const GET = withUserAuth(
  async (_request: NextRequest, { userId, apiKeyWorkspaceId, params }: Ctx) => {
    try {
      const workspace = await resolveApiWorkspace(params?.workspaceSlug ?? "", userId, { apiKeyWorkspaceId });
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

/** PUT — flip a resource between workspace-wide and teams-scoped access. Admin+. */
export const PUT = withUserAuth(
  async (request: NextRequest, { userId, apiKeyWorkspaceId, params }: Ctx) => {
    try {
      const workspace = await resolveApiWorkspace(params?.workspaceSlug ?? "", userId, { apiKeyWorkspaceId });
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
  // sessionOnly: an access-control mutation, same class as a role change.
  { sessionOnly: true }
);

function toErrorResponse(err: unknown): NextResponse {
  return toHttpErrorResponse("api/workspaces/[workspaceSlug]/access-matrix", err);
}

import { NextRequest, NextResponse } from "next/server";
import { withUserAuth } from "@/shared/auth/with-auth";
import { toHttpErrorResponse } from "@/shared/api/http-error-response";
import {
  resolveActiveWorkspace,
  WorkspaceResolutionError,
} from "@/features/workspaces/server/service";

/**
 * GET — the workspace the caller is scoped to, plus their role. Resolved by X-Workspace-Id, else
 * auto-targeted when the caller has exactly ONE active membership; 0 or 2+ with no header →
 * 400 WORKSPACE_REQUIRED.
 * Used by the MCP startup handshake to confirm membership. `userId` lets MCP tools self-identify
 * (e.g. dopl_members whoami) without a second lookup.
 */
export const GET = withUserAuth(async (request: NextRequest, { userId }) => {
  try {
    const headerWorkspaceId = request.headers.get("x-workspace-id");
    const { workspace, membership } = await resolveActiveWorkspace(
      userId,
      headerWorkspaceId
    );
    return NextResponse.json({ workspace, role: membership.role, userId });
  } catch (err) {
    if (err instanceof WorkspaceResolutionError) {
      return NextResponse.json(err.toResponseBody(), { status: err.status });
    }
    return toHttpErrorResponse("api/workspaces/me", err);
  }
});

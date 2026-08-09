import { NextRequest, NextResponse } from "next/server";
import { withUserAuth } from "@/shared/auth/with-auth";
import { toHttpErrorResponse } from "@/shared/api/http-error-response";
import {
  resolveActiveWorkspace,
  WorkspaceResolutionError,
} from "@/features/workspaces/server/service";

/**
 * GET /api/workspaces/me — return the workspace the caller is currently
 * scoped to (resolved by the X-Workspace-Id header, else auto-targeted when
 * the caller has exactly one active membership; 0 or 2+ with no header →
 * 400 WORKSPACE_REQUIRED) plus their role on it.
 *
 * Used by the MCP server's startup handshake to confirm the requested
 * workspace exists and the caller is an active member, and to print the
 * workspace name in stderr boot output. `userId` lets MCP tools
 * self-identify the caller (e.g. dopl_members whoami) without a
 * separate lookup.
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

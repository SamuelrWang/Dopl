import { NextRequest, NextResponse } from "next/server";
import { withUserAuth } from "@/shared/auth/with-auth";
import { resolveActiveWorkspace } from "@/features/workspaces/server/service";
import { HttpError } from "@/shared/lib/http-error";

/**
 * GET /api/workspaces/me — return the workspace the caller is currently
 * scoped to (resolved by the X-Workspace-Id header, falling back to the
 * user's default workspace) plus their role on it.
 *
 * Used by the MCP server's startup handshake to confirm the requested
 * workspace exists and the caller is an active member, and to print the
 * workspace name in stderr boot output.
 */
export const GET = withUserAuth(async (request: NextRequest, { userId }) => {
  try {
    const headerWorkspaceId = request.headers.get("x-workspace-id");
    const { workspace, membership } = await resolveActiveWorkspace(
      userId,
      headerWorkspaceId
    );
    return NextResponse.json({ workspace, role: membership.role });
  } catch (err) {
    if (err instanceof HttpError) {
      return NextResponse.json(err.toResponseBody(), { status: err.status });
    }
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
});

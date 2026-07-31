import { NextRequest, NextResponse } from "next/server";
import { withUserAuth } from "@/shared/auth/with-auth";
import { parseJson, validationResponseBody } from "@/shared/api/parse-json";
import { HttpError } from "@/shared/lib/http-error";
import { WorkspaceCreateSchema } from "@/features/workspaces/schema";
import {
  createWorkspaceForUser,
  listMyWorkspacesWithRole,
} from "@/features/workspaces/server/service";

/**
 * GET /api/workspaces — list every workspace the caller is an active
 * member of, with the caller's role on each. Response shape is a
 * superset of the pre-role version (existing clients ignore the new
 * field), and the MCP `list_workspaces` tool reads it directly.
 */
export const GET = withUserAuth(async (_request, { userId }) => {
  try {
    const workspaces = await listMyWorkspacesWithRole(userId);
    return NextResponse.json({ workspaces });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
});

/**
 * POST /api/workspaces — create a new workspace owned by the caller.
 */
export const POST = withUserAuth(async (request: NextRequest, { userId }) => {
  try {
    const input = await parseJson(request, WorkspaceCreateSchema);
    const workspace = await createWorkspaceForUser(userId, input);
    return NextResponse.json({ workspace }, { status: 201 });
  } catch (err) {
    if (err instanceof HttpError) {
      return NextResponse.json(validationResponseBody(err), { status: err.status });
    }
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
});

import { NextRequest, NextResponse } from "next/server";
import { withUserAuth } from "@/shared/auth/with-auth";
import { parseJson } from "@/shared/api/parse-json";
import { HttpError } from "@/shared/lib/http-error";
import { WorkspaceCreateSchema } from "@/features/workspaces/schema";
import {
  createWorkspaceForUser,
  listMyWorkspaces,
} from "@/features/workspaces/server/service";

/**
 * GET /api/workspaces — list every workspace the caller is an active member of.
 */
export const GET = withUserAuth(async (_request, { userId }) => {
  try {
    const workspaces = await listMyWorkspaces(userId);
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
      return NextResponse.json(err.toResponseBody(), { status: err.status });
    }
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
});

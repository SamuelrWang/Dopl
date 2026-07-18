import { NextRequest, NextResponse } from "next/server";
import {
  withWorkspaceAuth,
  type WorkspaceAuthContext,
} from "@/shared/auth/with-workspace-auth";
import { toTrashErrorResponse } from "@/features/trash/server/http-mapping";
import { listWorkspaceTrash } from "@/features/trash/server/service";

/**
 * GET /api/workspaces/[workspaceSlug]/trash — every trashed item across all
 * features the caller may see, newest-deleted first. `withWorkspaceAuth`
 * resolves membership + `workspaceId`, so the `[workspaceSlug]` segment is
 * cosmetic; the service scopes off `auth.workspaceId`.
 */
async function handleGet(_request: NextRequest, auth: WorkspaceAuthContext) {
  try {
    const items = await listWorkspaceTrash(auth);
    return NextResponse.json({ items });
  } catch (err) {
    return toTrashErrorResponse(err);
  }
}

export const GET = withWorkspaceAuth(handleGet, { minRole: "member" });

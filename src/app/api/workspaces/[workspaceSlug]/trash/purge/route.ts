import { NextRequest, NextResponse } from "next/server";
import {
  withWorkspaceAuth,
  type WorkspaceAuthContext,
} from "@/shared/auth/with-workspace-auth";
import { parseJson } from "@/shared/api/parse-json";
import { TrashActionSchema } from "@/features/trash/schema";
import { toTrashErrorResponse } from "@/features/trash/server/http-mapping";
import { purgeTrashItem } from "@/features/trash/server/service";

/**
 * POST /api/workspaces/[workspaceSlug]/trash/purge — permanently delete one
 * trashed item `{ kind, id }`. Dispatches to the owning feature's purge fn
 * (which refuses a live row and re-runs its gates); the feature's
 * NotTrashed/Forbidden/NotFound error surfaces with its real status.
 */
async function handlePost(request: NextRequest, auth: WorkspaceAuthContext) {
  try {
    const { kind, id } = await parseJson(request, TrashActionSchema);
    await purgeTrashItem(auth, kind, id);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return toTrashErrorResponse(err);
  }
}

export const POST = withWorkspaceAuth(handlePost, { minRole: "member" });

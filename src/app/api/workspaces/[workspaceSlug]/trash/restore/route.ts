import { NextRequest, NextResponse } from "next/server";
import {
  withWorkspaceAuth,
  type WorkspaceAuthContext,
} from "@/shared/auth/with-workspace-auth";
import { parseJson } from "@/shared/api/parse-json";
import { TrashActionSchema } from "@/features/trash/schema";
import { toTrashErrorResponse } from "@/features/trash/server/http-mapping";
import { restoreTrashItem } from "@/features/trash/server/service";

/**
 * POST /api/workspaces/[workspaceSlug]/trash/restore — restore one trashed
 * item `{ kind, id }`. Dispatches to the owning feature (which re-runs its
 * visibility + write gates); a feature's NotTrashed/Forbidden/NotFound error
 * surfaces with its real status via `toTrashErrorResponse`.
 */
async function handlePost(request: NextRequest, auth: WorkspaceAuthContext) {
  try {
    const { kind, id } = await parseJson(request, TrashActionSchema);
    await restoreTrashItem(auth, kind, id);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return toTrashErrorResponse(err);
  }
}

export const POST = withWorkspaceAuth(handlePost, { minRole: "member" });

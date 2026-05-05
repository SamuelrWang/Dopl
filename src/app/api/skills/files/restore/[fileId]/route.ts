import { NextRequest, NextResponse } from "next/server";
import { withWorkspaceAuth, type WorkspaceAuthContext } from "@/shared/auth/with-workspace-auth";
import { HttpError } from "@/shared/lib/http-error";
import { toSkillErrorResponse } from "@/shared/api/skill-route";
import {
  buildSkillContext,
  restoreSkillFile,
} from "@/features/skills/server/service";

/**
 * POST /api/skills/files/restore/[fileId] — restore a soft-deleted skill file.
 *
 * File-id-routed for the same reason `restore/[skillId]` is — soft-
 * deleted files aren't reachable via their parent skill's slug-scoped
 * paths.
 */
async function handlePost(_request: NextRequest, auth: WorkspaceAuthContext) {
  try {
    const id = auth.params?.fileId;
    if (!id) throw HttpError.badRequest("fileId is required");
    const ctx = buildSkillContext(auth);
    const file = await restoreSkillFile(ctx, id);
    return NextResponse.json({ file });
  } catch (err) {
    return toSkillErrorResponse(err);
  }
}

export const POST = withWorkspaceAuth(handlePost, { minRole: "member" });

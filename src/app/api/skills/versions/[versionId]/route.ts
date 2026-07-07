import { NextResponse } from "next/server";
import { withWorkspaceAuth } from "@/shared/auth/with-workspace-auth";
import { requireVersionId, toSkillErrorResponse } from "@/shared/api/skill-route";
import { buildSkillContext, getFileVersion } from "@/features/skills/server/service";

/**
 * GET /api/skills/versions/[versionId] — one snapshot with its full
 * body, for the diff view. Workspace-scoped; 404s when the caller
 * can't see the parent skill.
 */
export const GET = withWorkspaceAuth(async (_request, auth) => {
  try {
    const ctx = buildSkillContext(auth);
    const version = await getFileVersion(ctx, requireVersionId(auth.params));
    return NextResponse.json({ version });
  } catch (err) {
    return toSkillErrorResponse(err);
  }
});

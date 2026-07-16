import { NextResponse } from "next/server";
import { withWorkspaceAuth } from "@/shared/auth/with-workspace-auth";
import { requireVersionId, toSkillErrorResponse } from "@/shared/api/skill-route";
import { buildSkillContext, restoreFileVersion } from "@/features/skills/server/service";

/**
 * POST /api/skills/versions/[versionId]/restore — roll the skill body back
 * to this snapshot. Non-destructive: the old body is written as a NEW save
 * (the fresh version row is the audit record); history is never rewritten.
 */
export const POST = withWorkspaceAuth(async (_request, auth) => {
  try {
    const ctx = buildSkillContext(auth);
    const file = await restoreFileVersion(ctx, requireVersionId(auth.params));
    return NextResponse.json({ file });
  } catch (err) {
    return toSkillErrorResponse(err);
  }
});

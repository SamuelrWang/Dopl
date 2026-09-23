import { NextResponse } from "next/server";
import { withWorkspaceAuth } from "@/shared/auth/with-workspace-auth";
import { requireVersionId, toSkillErrorResponse } from "@/shared/api/skill-route";
import { buildSkillContext, restoreFileVersion } from "@/features/skills/server/service";

/** POST — roll the skill body back to this snapshot. ⚠ Non-destructive: the old body is written
 *  as a NEW save (that row is the audit record); history is never rewritten. Optional
 *  `X-Updated-At` precondition on the body's Version (the MCP restore always sends it) → 412. */
export const POST = withWorkspaceAuth(async (request, auth) => {
  try {
    const ctx = buildSkillContext(auth);
    const expectedUpdatedAt = request.headers.get("x-updated-at") ?? undefined;
    const file = await restoreFileVersion(ctx, requireVersionId(auth.params), expectedUpdatedAt);
    return NextResponse.json({ file });
  } catch (err) {
    return toSkillErrorResponse(err);
  }
}, { minRole: "member" });

import { NextResponse } from "next/server";
import { withWorkspaceAuth } from "@/shared/auth/with-workspace-auth";
import { requireSkillSlug, toSkillErrorResponse } from "@/shared/api/skill-route";
import { buildSkillContext, duplicateSkill } from "@/features/skills/server/service";

/**
 * POST /api/skills/[skillSlug]/duplicate — fork the skill into a new
 * private draft ("<name> (copy)") with every file copied. History is
 * recorded through the normal create paths.
 */
export const POST = withWorkspaceAuth(async (_request, auth) => {
  try {
    const ctx = buildSkillContext(auth);
    const created = await duplicateSkill(ctx, requireSkillSlug(auth.params));
    return NextResponse.json(created, { status: 201 });
  } catch (err) {
    return toSkillErrorResponse(err);
  }
}, { minRole: "member" });

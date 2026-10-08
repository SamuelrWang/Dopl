import { NextResponse } from "next/server";
import { withWorkspaceAuth } from "@/shared/auth/with-workspace-auth";
import { requireSkillSlug, toSkillErrorResponse } from "@/shared/api/skill-route";
import { buildSkillContext, duplicateSkill } from "@/features/skills/server/service";
import { noDerivation } from "@/shared/api/workspace-derivation";

// A skill SLUG is unique per workspace only, so it names no single container: the header decides.
const SKILL_SLUG_DERIVATION = noDerivation("skill slug is unique per workspace only");

/** POST — fork into a new private draft ("<name> (copy)") with every file copied. History is
 *  recorded through the normal create paths. */
export const POST = withWorkspaceAuth(async (_request, auth) => {
  try {
    const ctx = buildSkillContext(auth);
    const created = await duplicateSkill(ctx, requireSkillSlug(auth.params));
    return NextResponse.json(created, { status: 201 });
  } catch (err) {
    return toSkillErrorResponse(err);
  }
}, { workspaceFromParams: SKILL_SLUG_DERIVATION, minRole: "member" });

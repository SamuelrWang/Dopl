import { NextRequest, NextResponse } from "next/server";
import { withWorkspaceAuth, type WorkspaceAuthContext } from "@/shared/auth/with-workspace-auth";
import { HttpError } from "@/shared/lib/http-error";
import { toSkillErrorResponse } from "@/shared/api/skill-route";
import {
  buildSkillContext,
  restoreSkill,
} from "@/features/skills/server/service";

/**
 * POST /api/skills/restore/[skillId] — restore a soft-deleted skill.
 *
 * Mirrors `/api/knowledge/bases/[baseId]/restore`. Lives at
 * `/api/skills/restore/[skillId]` instead of `/api/skills/[skillSlug]/restore`
 * because the parent slug-routed endpoint filters out soft-deleted rows
 * (you can't address a trashed skill by its slug). Routing by id keeps
 * the action addressable while the row is in trash.
 */
async function handlePost(_request: NextRequest, auth: WorkspaceAuthContext) {
  try {
    const id = auth.params?.skillId;
    if (!id) throw HttpError.badRequest("skillId is required");
    const ctx = buildSkillContext(auth);
    const skill = await restoreSkill(ctx, id);
    return NextResponse.json({ skill });
  } catch (err) {
    return toSkillErrorResponse(err);
  }
}

export const POST = withWorkspaceAuth(handlePost, { minRole: "member" });

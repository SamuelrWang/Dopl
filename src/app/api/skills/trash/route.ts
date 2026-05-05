import { NextRequest, NextResponse } from "next/server";
import { withWorkspaceAuth, type WorkspaceAuthContext } from "@/shared/auth/with-workspace-auth";
import { toSkillErrorResponse } from "@/shared/api/skill-route";
import {
  buildSkillContext,
  listTrash,
} from "@/features/skills/server/service";

/**
 * GET /api/skills/trash — workspace-wide soft-deleted skills + skill files.
 *
 * Mirrors `/api/knowledge/trash`. Returns `{ skills, files }`. Member
 * role can read (so any workspace member sees what's recoverable);
 * restore/purge stay member+ / admin+ at their own routes.
 */
async function handleGet(_request: NextRequest, auth: WorkspaceAuthContext) {
  try {
    const ctx = buildSkillContext(auth);
    const trash = await listTrash(ctx);
    return NextResponse.json(trash);
  } catch (err) {
    return toSkillErrorResponse(err);
  }
}

export const GET = withWorkspaceAuth(handleGet);

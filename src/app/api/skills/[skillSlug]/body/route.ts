import { NextRequest, NextResponse } from "next/server";
import { withWorkspaceAuth, type WorkspaceAuthContext } from "@/shared/auth/with-workspace-auth";
import { parseJson } from "@/shared/api/parse-json";
import { requireSkillSlug, toSkillErrorResponse } from "@/shared/api/skill-route";
import {
  buildSkillContext,
  readBody,
  writeBody,
} from "@/features/skills/server/service";
import { SkillFileWriteSchema } from "@/features/skills/schema";

/**
 * Read / write the skill's single SKILL.md body. GET returns the row (body + `updatedAt` version
 * token); PUT overwrites under the X-Updated-At precondition (→ 412 on mismatch).
 */
async function handleGet(_request: NextRequest, auth: WorkspaceAuthContext) {
  try {
    const ctx = buildSkillContext(auth);
    const file = await readBody(ctx, requireSkillSlug(auth.params));
    return NextResponse.json({ file });
  } catch (err) {
    return toSkillErrorResponse(err);
  }
}

async function handlePut(request: NextRequest, auth: WorkspaceAuthContext) {
  try {
    const ctx = buildSkillContext(auth);
    const input = await parseJson(request, SkillFileWriteSchema);
    // Precondition on the row's updated_at. Mismatch → 412 SKILL_STALE_VERSION.
    const expectedUpdatedAt = request.headers.get("x-updated-at") ?? undefined;
    const { file, skillUpdatedAt } = await writeBody(
      ctx,
      requireSkillSlug(auth.params),
      input,
      expectedUpdatedAt
    );
    // `skillUpdatedAt` is the row's metadata-CAS clock post-write; the web editor threads it as
    // its metadata precondition. MCP clients ignore the extra field.
    return NextResponse.json({ file, skillUpdatedAt });
  } catch (err) {
    return toSkillErrorResponse(err);
  }
}

export const GET = withWorkspaceAuth(handleGet);
export const PUT = withWorkspaceAuth(handlePut, { minRole: "member" });

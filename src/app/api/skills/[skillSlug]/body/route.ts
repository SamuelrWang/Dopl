import { NextRequest, NextResponse } from "next/server";
import { withWorkspaceAuth, type WorkspaceAuthContext } from "@/shared/auth/with-workspace-auth";
import { parseJson } from "@/shared/api/parse-json";
import { skillUrl } from "@/shared/lib/url/resource-url";
import { requireSkillSlug, toSkillErrorResponse } from "@/shared/api/skill-route";
import {
  buildSkillContext,
  readBody,
  writeBody,
} from "@/features/skills/server/service";
import { SkillFileWriteSchema } from "@/features/skills/schema";

/**
 * Read / write the skill's single SKILL.md body.
 *
 * Skills are single-file: this replaces the old per-file-name
 * `/files/[fileName]` surface. GET returns the SKILL.md row (body +
 * `updatedAt` version token); PUT overwrites it with the same
 * optimistic-concurrency precondition (X-Updated-At → 412 on mismatch).
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
    // Optimistic-concurrency precondition on the SKILL.md row's
    // updated_at. Mismatch → 412 SKILL_STALE_VERSION; client surfaces
    // conflict resolution.
    const expectedUpdatedAt = request.headers.get("x-updated-at") ?? undefined;
    const { file, skill } = await writeBody(
      ctx,
      requireSkillSlug(auth.params),
      input,
      expectedUpdatedAt
    );
    const webUrl = skillUrl({
      origin: request.nextUrl.origin,
      workspace: { slug: auth.workspaceSlug, publicId: auth.workspacePublicId },
      skill,
    });
    return NextResponse.json({ file, webUrl });
  } catch (err) {
    return toSkillErrorResponse(err);
  }
}

export const GET = withWorkspaceAuth(handleGet);
export const PUT = withWorkspaceAuth(handlePut, { minRole: "member" });

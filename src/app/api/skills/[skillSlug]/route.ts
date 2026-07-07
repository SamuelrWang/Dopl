import { NextRequest, NextResponse } from "next/server";
import { withWorkspaceAuth, type WorkspaceAuthContext } from "@/shared/auth/with-workspace-auth";
import { parseJson } from "@/shared/api/parse-json";
import { requireSkillSlug, toSkillErrorResponse } from "@/shared/api/skill-route";
import {
  buildSkillContext,
  deleteSkill,
  resolveSkillBody,
  updateSkill,
} from "@/features/skills/server/service";
import {
  SkillUpdateSchema,
} from "@/features/skills/schema";

async function handleGet(_request: NextRequest, auth: WorkspaceAuthContext) {
  try {
    const ctx = buildSkillContext(auth);
    const slug = requireSkillSlug(auth.params);
    const resolved = await resolveSkillBody(ctx, slug);
    return NextResponse.json(resolved);
  } catch (err) {
    return toSkillErrorResponse(err);
  }
}

async function handlePatch(request: NextRequest, auth: WorkspaceAuthContext) {
  try {
    const ctx = buildSkillContext(auth);
    const slug = requireSkillSlug(auth.params);
    const patch = await parseJson(request, SkillUpdateSchema);
    // Optimistic-concurrency precondition. Mismatch → 412
    // SKILL_STALE_VERSION; client must surface conflict resolution
    // rather than retry blindly.
    const expectedUpdatedAt =
      request.headers.get("x-updated-at") ?? undefined;
    const skill = await updateSkill(ctx, slug, patch, expectedUpdatedAt);
    return NextResponse.json({ skill });
  } catch (err) {
    return toSkillErrorResponse(err);
  }
}

async function handleDelete(_request: NextRequest, auth: WorkspaceAuthContext) {
  try {
    const ctx = buildSkillContext(auth);
    const slug = requireSkillSlug(auth.params);
    await deleteSkill(ctx, slug);
    return new NextResponse(null, { status: 204 });
  } catch (err) {
    return toSkillErrorResponse(err);
  }
}

export const GET = withWorkspaceAuth(handleGet);
export const PATCH = withWorkspaceAuth(handlePatch, { minRole: "member" });
export const DELETE = withWorkspaceAuth(handleDelete, { minRole: "member" });

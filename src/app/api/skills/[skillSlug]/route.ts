import { NextRequest, NextResponse } from "next/server";
import { withWorkspaceAuth, type WorkspaceAuthContext } from "@/shared/auth/with-workspace-auth";
import { parseJson } from "@/shared/api/parse-json";
import { HttpError } from "@/shared/lib/http-error";
import { toSkillErrorResponse } from "@/shared/api/skill-route";
import {
  buildSkillContext,
  deleteSkill,
  resolveSkillBody,
  updateSkill,
} from "@/features/skills/server/service";
import {
  SkillSlugSchema,
  SkillUpdateSchema,
} from "@/features/skills/schema";

function requireSkillSlug(auth: WorkspaceAuthContext): string {
  const raw = auth.params?.skillSlug;
  if (!raw) throw HttpError.badRequest("skillSlug is required");
  const result = SkillSlugSchema.safeParse(raw);
  if (!result.success) throw HttpError.badRequest("Invalid skill slug");
  return result.data;
}

async function handleGet(_request: NextRequest, auth: WorkspaceAuthContext) {
  try {
    const ctx = buildSkillContext(auth);
    const slug = requireSkillSlug(auth);
    const resolved = await resolveSkillBody(ctx, slug);
    return NextResponse.json(resolved);
  } catch (err) {
    return toSkillErrorResponse(err);
  }
}

async function handlePatch(request: NextRequest, auth: WorkspaceAuthContext) {
  try {
    const ctx = buildSkillContext(auth);
    const slug = requireSkillSlug(auth);
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
    const slug = requireSkillSlug(auth);
    await deleteSkill(ctx, slug);
    return new NextResponse(null, { status: 204 });
  } catch (err) {
    return toSkillErrorResponse(err);
  }
}

export const GET = withWorkspaceAuth(handleGet);
export const PATCH = withWorkspaceAuth(handlePatch, { minRole: "editor" });
export const DELETE = withWorkspaceAuth(handleDelete, { minRole: "editor" });

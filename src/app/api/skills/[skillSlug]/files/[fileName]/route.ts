import { NextRequest, NextResponse } from "next/server";
import { withWorkspaceAuth, type WorkspaceAuthContext } from "@/shared/auth/with-workspace-auth";
import { parseJson } from "@/shared/api/parse-json";
import { HttpError } from "@/shared/lib/http-error";
import { skillUrl } from "@/shared/lib/url/resource-url";
import { requireSkillSlug, toSkillErrorResponse } from "@/shared/api/skill-route";
import {
  buildSkillContext,
  deleteFile,
  readFile,
  renameFile,
  writeFile,
} from "@/features/skills/server/service";
import {
  SkillFileNameSchema,
  SkillFileRenameSchema,
  SkillFileWriteSchema,
} from "@/features/skills/schema";

function requireFileName(auth: WorkspaceAuthContext): string {
  const raw = auth.params?.fileName;
  if (!raw) throw HttpError.badRequest("fileName is required");
  const decoded = decodeURIComponent(raw);
  const result = SkillFileNameSchema.safeParse(decoded);
  if (!result.success) throw HttpError.badRequest("Invalid file name");
  return result.data;
}

async function handleGet(_request: NextRequest, auth: WorkspaceAuthContext) {
  try {
    const ctx = buildSkillContext(auth);
    const file = await readFile(ctx, requireSkillSlug(auth.params), requireFileName(auth));
    return NextResponse.json({ file });
  } catch (err) {
    return toSkillErrorResponse(err);
  }
}

async function handlePut(request: NextRequest, auth: WorkspaceAuthContext) {
  try {
    const ctx = buildSkillContext(auth);
    const input = await parseJson(request, SkillFileWriteSchema);
    // Optimistic-concurrency precondition on the file row's
    // updated_at. Mismatch → 412 SKILL_STALE_VERSION; client surfaces
    // conflict resolution.
    const expectedUpdatedAt =
      request.headers.get("x-updated-at") ?? undefined;
    const { file, skill } = await writeFile(
      ctx,
      requireSkillSlug(auth.params),
      requireFileName(auth),
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

async function handlePatch(request: NextRequest, auth: WorkspaceAuthContext) {
  try {
    const ctx = buildSkillContext(auth);
    const input = await parseJson(request, SkillFileRenameSchema);
    const file = await renameFile(
      ctx,
      requireSkillSlug(auth.params),
      requireFileName(auth),
      input
    );
    return NextResponse.json({ file });
  } catch (err) {
    return toSkillErrorResponse(err);
  }
}

async function handleDelete(_request: NextRequest, auth: WorkspaceAuthContext) {
  try {
    const ctx = buildSkillContext(auth);
    await deleteFile(ctx, requireSkillSlug(auth.params), requireFileName(auth));
    return new NextResponse(null, { status: 204 });
  } catch (err) {
    return toSkillErrorResponse(err);
  }
}

export const GET = withWorkspaceAuth(handleGet);
export const PUT = withWorkspaceAuth(handlePut, { minRole: "member" });
export const PATCH = withWorkspaceAuth(handlePatch, { minRole: "member" });
export const DELETE = withWorkspaceAuth(handleDelete, { minRole: "member" });

import { NextRequest, NextResponse } from "next/server";
import { withWorkspaceAuth, type WorkspaceAuthContext } from "@/shared/auth/with-workspace-auth";
import { parseJson } from "@/shared/api/parse-json";
import { HttpError } from "@/shared/lib/http-error";
import { toSkillErrorResponse } from "@/shared/api/skill-route";
import {
  buildSkillContext,
  createFile,
  listFiles,
} from "@/features/skills/server/service";
import {
  SkillFileCreateSchema,
  SkillSlugSchema,
} from "@/features/skills/schema";

function requireSkillSlug(auth: WorkspaceAuthContext): string {
  const raw = auth.params?.skillSlug;
  if (!raw) throw HttpError.badRequest("skillSlug is required");
  const result = SkillSlugSchema.safeParse(raw);
  if (!result.success) throw HttpError.badRequest("Invalid skill slug");
  return result.data;
}

async function handleGet(request: NextRequest, auth: WorkspaceAuthContext) {
  try {
    const ctx = buildSkillContext(auth);
    const slug = requireSkillSlug(auth);
    const includeBody = request.nextUrl.searchParams.get("includeBody") !== "false";
    const files = await listFiles(ctx, slug, { includeBody });
    return NextResponse.json({ files });
  } catch (err) {
    return toSkillErrorResponse(err);
  }
}

async function handlePost(request: NextRequest, auth: WorkspaceAuthContext) {
  try {
    const ctx = buildSkillContext(auth);
    const slug = requireSkillSlug(auth);
    const input = await parseJson(request, SkillFileCreateSchema);
    const file = await createFile(ctx, slug, input);
    return NextResponse.json({ file }, { status: 201 });
  } catch (err) {
    return toSkillErrorResponse(err);
  }
}

export const GET = withWorkspaceAuth(handleGet);
export const POST = withWorkspaceAuth(handlePost, { minRole: "editor" });

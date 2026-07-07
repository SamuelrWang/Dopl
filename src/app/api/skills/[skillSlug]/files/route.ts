import { NextRequest, NextResponse } from "next/server";
import { withWorkspaceAuth, type WorkspaceAuthContext } from "@/shared/auth/with-workspace-auth";
import { parseJson } from "@/shared/api/parse-json";
import { requireSkillSlug, toSkillErrorResponse } from "@/shared/api/skill-route";
import {
  buildSkillContext,
  createFile,
  listFiles,
} from "@/features/skills/server/service";
import {
  SkillFileCreateSchema,
} from "@/features/skills/schema";

async function handleGet(request: NextRequest, auth: WorkspaceAuthContext) {
  try {
    const ctx = buildSkillContext(auth);
    const slug = requireSkillSlug(auth.params);
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
    const slug = requireSkillSlug(auth.params);
    const input = await parseJson(request, SkillFileCreateSchema);
    const file = await createFile(ctx, slug, input);
    return NextResponse.json({ file }, { status: 201 });
  } catch (err) {
    return toSkillErrorResponse(err);
  }
}

export const GET = withWorkspaceAuth(handleGet);
export const POST = withWorkspaceAuth(handlePost, { minRole: "member" });

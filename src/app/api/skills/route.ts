import { NextRequest, NextResponse } from "next/server";
import { withWorkspaceAuth, type WorkspaceAuthContext } from "@/shared/auth/with-workspace-auth";
import { parseJson } from "@/shared/api/parse-json";
import { toSkillErrorResponse } from "@/shared/api/skill-route";
import {
  buildSkillContext,
  createSkill,
  listSkills,
} from "@/features/skills/server/service";
import { SkillCreateSchema } from "@/features/skills/schema";

async function handleGet(_request: NextRequest, auth: WorkspaceAuthContext) {
  try {
    const ctx = buildSkillContext(auth);
    const skills = await listSkills(ctx);
    return NextResponse.json({ skills });
  } catch (err) {
    return toSkillErrorResponse(err);
  }
}

async function handlePost(request: NextRequest, auth: WorkspaceAuthContext) {
  try {
    const input = await parseJson(request, SkillCreateSchema);
    const ctx = buildSkillContext(auth);
    const result = await createSkill(ctx, input);
    return NextResponse.json(result, { status: 201 });
  } catch (err) {
    return toSkillErrorResponse(err);
  }
}

export const GET = withWorkspaceAuth(handleGet);
export const POST = withWorkspaceAuth(handlePost, { minRole: "editor" });

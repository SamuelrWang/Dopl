import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { withWorkspaceAuth } from "@/shared/auth/with-workspace-auth";
import { parseJson } from "@/shared/api/parse-json";
import { HttpError } from "@/shared/lib/http-error";
import {
  attachSkill,
  listAttachedSkills,
} from "@/features/clusters/server/attachments";

const AttachSchema = z.object({
  skill_id: z.string().uuid(),
});

interface Ctx {
  userId: string;
  workspaceId: string;
  apiKeyId?: string;
  params?: Record<string, string>;
}

function toErrorResponse(err: unknown): NextResponse {
  if (err instanceof HttpError) {
    return NextResponse.json(err.toResponseBody(), { status: err.status });
  }
  const message = err instanceof Error ? err.message : "Unknown error";
  return NextResponse.json(
    { error: { code: "INTERNAL_ERROR", message } },
    { status: 500 }
  );
}

async function handleGet(_request: NextRequest, ctx: Ctx) {
  try {
    const slug = ctx.params?.slug;
    if (!slug) {
      throw new HttpError(400, "MISSING_SLUG", "cluster slug required");
    }
    const items = await listAttachedSkills(slug, {
      userId: ctx.userId,
      workspaceId: ctx.workspaceId,
      source: ctx.apiKeyId ? "agent" : "user",
    });
    return NextResponse.json({ skills: items });
  } catch (err) {
    return toErrorResponse(err);
  }
}

async function handlePost(request: NextRequest, ctx: Ctx) {
  try {
    const slug = ctx.params?.slug;
    if (!slug) {
      throw new HttpError(400, "MISSING_SLUG", "cluster slug required");
    }
    const input = await parseJson(request, AttachSchema);
    const item = await attachSkill(slug, input.skill_id, {
      userId: ctx.userId,
      workspaceId: ctx.workspaceId,
      source: ctx.apiKeyId ? "agent" : "user",
    });
    return NextResponse.json(item, { status: 201 });
  } catch (err) {
    return toErrorResponse(err);
  }
}

export const GET = withWorkspaceAuth(handleGet);
export const POST = withWorkspaceAuth(handlePost, { minRole: "editor" });

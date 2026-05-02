import { NextRequest, NextResponse } from "next/server";
import { withWorkspaceAuth } from "@/shared/auth/with-workspace-auth";
import { HttpError } from "@/shared/lib/http-error";
import { detachSkill } from "@/features/clusters/server/attachments";

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

async function handleDelete(_request: NextRequest, ctx: Ctx) {
  try {
    const slug = ctx.params?.slug;
    const skillId = ctx.params?.skillId;
    if (!slug || !skillId) {
      throw new HttpError(400, "MISSING_PARAMS", "slug + skillId required");
    }
    await detachSkill(slug, skillId, {
      userId: ctx.userId,
      workspaceId: ctx.workspaceId,
      source: ctx.apiKeyId ? "agent" : "user",
    });
    return new NextResponse(null, { status: 204 });
  } catch (err) {
    return toErrorResponse(err);
  }
}

export const DELETE = withWorkspaceAuth(handleDelete, { minRole: "editor" });

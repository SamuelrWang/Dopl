import { NextRequest, NextResponse } from "next/server";
import { withWorkspaceAuth } from "@/shared/auth/with-workspace-auth";
import { HttpError } from "@/shared/lib/http-error";
import { detachKnowledgeBase } from "@/features/clusters/server/attachments";

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
    const kbId = ctx.params?.kbId;
    if (!slug || !kbId) {
      throw new HttpError(400, "MISSING_PARAMS", "slug + kbId required");
    }
    await detachKnowledgeBase(slug, kbId, {
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

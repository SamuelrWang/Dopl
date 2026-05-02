import { NextRequest, NextResponse } from "next/server";
import { withWorkspaceAuth } from "@/shared/auth/with-workspace-auth";
import { HttpError } from "@/shared/lib/http-error";
import { readClusterKnowledgeEntry } from "@/features/clusters/server/attachments";

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
    const { slug, kbId, entryId } = ctx.params ?? {};
    if (!slug || !kbId || !entryId) {
      throw new HttpError(
        400,
        "MISSING_PARAMS",
        "slug + kbId + entryId required"
      );
    }
    const result = await readClusterKnowledgeEntry(slug, kbId, entryId, {
      userId: ctx.userId,
      workspaceId: ctx.workspaceId,
      source: ctx.apiKeyId ? "agent" : "user",
    });
    return NextResponse.json(result);
  } catch (err) {
    return toErrorResponse(err);
  }
}

export const GET = withWorkspaceAuth(handleGet);

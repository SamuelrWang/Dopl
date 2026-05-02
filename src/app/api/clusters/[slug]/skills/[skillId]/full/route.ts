import { NextRequest, NextResponse } from "next/server";
import { withWorkspaceAuth } from "@/shared/auth/with-workspace-auth";
import { HttpError } from "@/shared/lib/http-error";
import { readClusterSkill } from "@/features/clusters/server/attachments";

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

// The dynamic segment is `skillId` to match the existing detach route's
// folder name, but the value is treated as a slug here — `readClusterSkill`
// resolves it against `skills.slug`. The MCP tool passes the slug directly.
async function handleGet(_request: NextRequest, ctx: Ctx) {
  try {
    const { slug, skillId } = ctx.params ?? {};
    if (!slug || !skillId) {
      throw new HttpError(400, "MISSING_PARAMS", "slug + skillId required");
    }
    const result = await readClusterSkill(slug, skillId, {
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

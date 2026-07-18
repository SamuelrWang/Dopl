import { NextRequest, NextResponse } from "next/server";
import { HttpError } from "@/shared/lib/http-error";
import { withWorkspaceAuth } from "@/shared/auth/with-workspace-auth";
import type { Role } from "@/features/workspaces/types";
import { restoreWorkflow } from "@/features/workflows/server/service";

interface Ctx {
  userId: string;
  workspaceId: string;
  role: Role;
  agentTokenId?: string;
  params?: Record<string, string>;
}

function scopeOf(ctx: Ctx) {
  return {
    userId: ctx.userId,
    workspaceId: ctx.workspaceId,
    role: ctx.role,
    source: ctx.agentTokenId ? ("agent" as const) : ("user" as const),
  };
}

function toErrorResponse(err: unknown): NextResponse {
  if (err instanceof HttpError) {
    return NextResponse.json(err.toResponseBody(), { status: err.status });
  }
  console.error("[api/workflows/[id]/restore]", err);
  return NextResponse.json(
    { error: { code: "INTERNAL_ERROR", message: "Internal error" } },
    { status: 500 }
  );
}

async function handlePost(_request: NextRequest, ctx: Ctx) {
  try {
    const id = ctx.params?.id;
    if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });
    const workflow = await restoreWorkflow(id, scopeOf(ctx));
    return NextResponse.json(workflow);
  } catch (error) {
    return toErrorResponse(error);
  }
}

export const POST = withWorkspaceAuth(handlePost, { minRole: "member" });

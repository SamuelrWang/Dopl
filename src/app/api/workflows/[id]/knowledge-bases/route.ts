import { NextRequest, NextResponse } from "next/server";
import { withWorkspaceAuth } from "@/shared/auth/with-workspace-auth";
import { HttpError } from "@/shared/lib/http-error";
import {
  attachKnowledgeBase,
  detachKnowledgeBase,
  resolveWorkflowId,
} from "@/features/workflows/server/attachments";

interface Ctx {
  userId: string;
  workspaceId: string;
  agentTokenId?: string;
  params?: Record<string, string>;
}

function scopeOf(ctx: Ctx) {
  return {
    userId: ctx.userId,
    workspaceId: ctx.workspaceId,
    source: ctx.agentTokenId ? ("agent" as const) : ("user" as const),
  };
}

function toError(err: unknown): NextResponse {
  if (err instanceof HttpError)
    return NextResponse.json(err.toResponseBody(), { status: err.status });
  const message = err instanceof Error ? err.message : "Unknown error";
  return NextResponse.json(
    { error: { code: "INTERNAL_ERROR", message } },
    { status: message.toLowerCase().includes("not found") ? 404 : 500 }
  );
}

async function handlePost(request: NextRequest, ctx: Ctx) {
  try {
    const id = ctx.params?.id;
    if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });
    const body = await request.json();
    const kbId = body?.knowledge_base_id;
    if (typeof kbId !== "string")
      return NextResponse.json({ error: "knowledge_base_id required" }, { status: 400 });
    const scope = scopeOf(ctx);
    const workflowId = await resolveWorkflowId(id, scope);
    await attachKnowledgeBase(workflowId, kbId, scope);
    return new NextResponse(null, { status: 204 });
  } catch (err) {
    return toError(err);
  }
}

async function handleDelete(request: NextRequest, ctx: Ctx) {
  try {
    const id = ctx.params?.id;
    if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });
    const body = await request.json().catch(() => ({}));
    const kbId = body?.knowledge_base_id;
    if (typeof kbId !== "string")
      return NextResponse.json({ error: "knowledge_base_id required" }, { status: 400 });
    const scope = scopeOf(ctx);
    const workflowId = await resolveWorkflowId(id, scope);
    await detachKnowledgeBase(workflowId, kbId, scope);
    return new NextResponse(null, { status: 204 });
  } catch (err) {
    return toError(err);
  }
}

export const POST = withWorkspaceAuth(handlePost, { minRole: "member" });
export const DELETE = withWorkspaceAuth(handleDelete, { minRole: "member" });

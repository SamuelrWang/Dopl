import { NextRequest, NextResponse } from "next/server";
import { withWorkspaceAuth } from "@/shared/auth/with-workspace-auth";
import type { Role } from "@/features/workspaces/types";
import { toHttpErrorResponse } from "@/shared/api/http-error-response";
import {
  attachSkill,
  detachSkill,
  resolveWorkflowId,
} from "@/features/workflows/server/attachments";

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

/**
 * Every not-found this route can produce is already a typed `HttpError`
 * (`WORKFLOW_NOT_FOUND` / `SKILL_NOT_FOUND` in
 * `workflows/server/attachments.ts`), which the shared tail passes through with
 * its own 404. The old string-sniff on `message` never fired for them and only
 * ever echoed the raw exception text back (ENGINEERING §9).
 */
function toError(err: unknown): NextResponse {
  return toHttpErrorResponse("api/workflows/[id]/skills", err);
}

async function handlePost(request: NextRequest, ctx: Ctx) {
  try {
    const id = ctx.params?.id;
    if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });
    const body = await request.json();
    const skillId = body?.skill_id;
    if (typeof skillId !== "string")
      return NextResponse.json({ error: "skill_id required" }, { status: 400 });
    const scope = scopeOf(ctx);
    const workflowId = await resolveWorkflowId(id, scope);
    await attachSkill(workflowId, skillId, scope);
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
    const skillId = body?.skill_id;
    if (typeof skillId !== "string")
      return NextResponse.json({ error: "skill_id required" }, { status: 400 });
    const scope = scopeOf(ctx);
    const workflowId = await resolveWorkflowId(id, scope);
    await detachSkill(workflowId, skillId, scope);
    return new NextResponse(null, { status: 204 });
  } catch (err) {
    return toError(err);
  }
}

export const POST = withWorkspaceAuth(handlePost, { minRole: "member" });
export const DELETE = withWorkspaceAuth(handleDelete, { minRole: "member" });

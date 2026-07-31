import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { withWorkspaceAuth } from "@/shared/auth/with-workspace-auth";
import type { Role } from "@/features/workspaces/types";
import { HttpError } from "@/shared/lib/http-error";
import { parseJson } from "@/shared/api/parse-json";
import { DESCRIPTION_MAX } from "@/config";
import { WorkflowStepTitleSchema } from "@/features/workflows/schema";
import {
  requireWorkflowEdit,
  resolveWorkflowId,
} from "@/features/workflows/server/attachments";
import { removeNode, updateNode } from "@/features/workflows/server/authoring";

interface Ctx {
  userId: string;
  workspaceId: string;
  role: Role;
  agentTokenId?: string;
  params?: Record<string, string>;
}

const PatchBody = z.object({
  title: WorkflowStepTitleSchema.optional(),
  description: z.string().max(2000).optional(),
  reads: z.array(z.object({ kbId: z.string().min(1), entryId: z.string().uuid().optional() })).max(50).optional(),
  actions: z.array(z.object({ skillId: z.string().min(1) })).max(50).optional(),
  userInput: z.string().max(DESCRIPTION_MAX * 8).optional(),
  agentOutput: z.string().max(DESCRIPTION_MAX * 8).optional(),
  nextInstructions: z.string().max(DESCRIPTION_MAX * 8).optional(),
});

function scopeOf(ctx: Ctx) {
  return {
    userId: ctx.userId,
    workspaceId: ctx.workspaceId,
    role: ctx.role,
    source: ctx.agentTokenId ? ("agent" as const) : ("user" as const),
  };
}

function toError(err: unknown): NextResponse {
  if (err instanceof HttpError)
    return NextResponse.json(err.toResponseBody(), { status: err.status });
  console.error("[api/workflows/nodes/:nodeId]", err);
  return NextResponse.json(
    { error: { code: "INTERNAL_ERROR", message: "Internal error" } },
    { status: 500 }
  );
}

async function handlePatch(request: NextRequest, ctx: Ctx) {
  try {
    const { id, nodeId } = ctx.params ?? {};
    if (!id || !nodeId) return NextResponse.json({ error: "id + nodeId required" }, { status: 400 });
    const data = await parseJson(request, PatchBody);
    const scope = scopeOf(ctx);
    const workflowId = await resolveWorkflowId(id, scope);
    await requireWorkflowEdit(workflowId, scope);
    await updateNode(workflowId, nodeId, data, scope);
    return new NextResponse(null, { status: 204 });
  } catch (err) {
    return toError(err);
  }
}

async function handleDelete(_request: NextRequest, ctx: Ctx) {
  try {
    const { id, nodeId } = ctx.params ?? {};
    if (!id || !nodeId) return NextResponse.json({ error: "id + nodeId required" }, { status: 400 });
    const scope = scopeOf(ctx);
    const workflowId = await resolveWorkflowId(id, scope);
    await requireWorkflowEdit(workflowId, scope);
    await removeNode(workflowId, nodeId, scope);
    return new NextResponse(null, { status: 204 });
  } catch (err) {
    return toError(err);
  }
}

export const PATCH = withWorkspaceAuth(handlePatch, { minRole: "member" });
export const DELETE = withWorkspaceAuth(handleDelete, { minRole: "member" });

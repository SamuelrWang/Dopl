import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { withWorkspaceAuth } from "@/shared/auth/with-workspace-auth";
import type { Role } from "@/features/workspaces/types";
import { HttpError } from "@/shared/lib/http-error";
import { parseJson } from "@/shared/api/parse-json";
import { DESCRIPTION_MAX } from "@/config";
import {
  requireWorkflowEdit,
  resolveWorkflowId,
} from "@/features/workflows/server/attachments";
import { addNode } from "@/features/workflows/server/authoring";

interface Ctx {
  userId: string;
  workspaceId: string;
  role: Role;
  agentTokenId?: string;
  params?: Record<string, string>;
}

const NodeBody = z.object({
  ref: z.string().min(1).max(120),
  title: z.string().max(200).optional(),
  description: z.string().max(2000).optional(),
  reads: z.array(z.object({ kbId: z.string().min(1), entryId: z.string().uuid().optional() })).max(50).optional(),
  actions: z.array(z.object({ skillId: z.string().min(1) })).max(50).optional(),
  userInput: z.string().max(DESCRIPTION_MAX * 8).optional(),
  agentOutput: z.string().max(DESCRIPTION_MAX * 8).optional(),
  nextInstructions: z.string().max(DESCRIPTION_MAX * 8).optional(),
  connect_from: z.string().min(1).optional(),
});

function toError(err: unknown): NextResponse {
  if (err instanceof HttpError)
    return NextResponse.json(err.toResponseBody(), { status: err.status });
  console.error("[api/workflows/nodes]", err);
  return NextResponse.json(
    { error: { code: "INTERNAL_ERROR", message: "Internal error" } },
    { status: 500 }
  );
}

async function handlePost(request: NextRequest, ctx: Ctx) {
  try {
    const id = ctx.params?.id;
    if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });
    const data = await parseJson(request, NodeBody);
    const scope = {
      userId: ctx.userId,
      workspaceId: ctx.workspaceId,
      role: ctx.role,
      source: ctx.agentTokenId ? ("agent" as const) : ("user" as const),
    };
    const workflowId = await resolveWorkflowId(id, scope);
    await requireWorkflowEdit(workflowId, scope);
    const { connect_from, ...node } = data;
    const nodeId = await addNode(workflowId, node, connect_from, scope);
    return NextResponse.json({ node_id: nodeId }, { status: 201 });
  } catch (err) {
    return toError(err);
  }
}

export const POST = withWorkspaceAuth(handlePost, { minRole: "member" });

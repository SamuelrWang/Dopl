import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { withWorkspaceAuth } from "@/shared/auth/with-workspace-auth";
import { HttpError } from "@/shared/lib/http-error";
import { denyIfNoCanvasWrite } from "@/features/members/server/access";
import { DESCRIPTION_MAX } from "@/config";
import { resolveWorkflowId } from "@/features/workflows/server/attachments";
import { addNode } from "@/features/workflows/server/authoring";

interface Ctx {
  userId: string;
  workspaceId: string;
  agentTokenId?: string;
  params?: Record<string, string>;
}

const NodeBody = z.object({
  ref: z.string().min(1).max(120),
  title: z.string().max(200).optional(),
  description: z.string().max(2000).optional(),
  reads: z.array(z.object({ kbId: z.string().uuid(), entryId: z.string().uuid().optional() })).max(50).optional(),
  actions: z.array(z.object({ skillId: z.string().uuid() })).max(50).optional(),
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
    const denied = await denyIfNoCanvasWrite({
      agentTokenId: ctx.agentTokenId,
      userId: ctx.userId,
      workspaceId: ctx.workspaceId,
    });
    if (denied) return denied;

    const id = ctx.params?.id;
    if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });
    const parsed = NodeBody.safeParse(await request.json());
    if (!parsed.success) {
      return NextResponse.json(
        { error: { code: "VALIDATION_FAILED", issues: parsed.error.issues } },
        { status: 400 }
      );
    }
    const scope = {
      userId: ctx.userId,
      workspaceId: ctx.workspaceId,
      source: ctx.agentTokenId ? ("agent" as const) : ("user" as const),
    };
    const workflowId = await resolveWorkflowId(id, scope);
    const { connect_from, ...node } = parsed.data;
    const nodeId = await addNode(workflowId, node, connect_from, scope);
    return NextResponse.json({ node_id: nodeId }, { status: 201 });
  } catch (err) {
    return toError(err);
  }
}

export const POST = withWorkspaceAuth(handlePost, { minRole: "member" });

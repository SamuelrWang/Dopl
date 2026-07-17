import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { withWorkspaceAuth } from "@/shared/auth/with-workspace-auth";
import type { Role } from "@/features/workspaces/types";
import { HttpError } from "@/shared/lib/http-error";
import { DESCRIPTION_MAX } from "@/config";
import {
  requireWorkflowEdit,
  resolveWorkflowId,
} from "@/features/workflows/server/attachments";
import { setGraph } from "@/features/workflows/server/authoring";

interface Ctx {
  userId: string;
  workspaceId: string;
  role: Role;
  agentTokenId?: string;
  params?: Record<string, string>;
}

const ReadRef = z.object({ kbId: z.string().min(1), entryId: z.string().uuid().optional() });
const ActionRef = z.object({ skillId: z.string().min(1) });
const NodeSpec = z.object({
  ref: z.string().min(1).max(120),
  title: z.string().max(200).optional(),
  description: z.string().max(2000).optional(),
  reads: z.array(ReadRef).max(50).optional(),
  actions: z.array(ActionRef).max(50).optional(),
  userInput: z.string().max(DESCRIPTION_MAX * 8).optional(),
  agentOutput: z.string().max(DESCRIPTION_MAX * 8).optional(),
  nextInstructions: z.string().max(DESCRIPTION_MAX * 8).optional(),
});
const EdgeSpec = z.object({
  from: z.string().min(1),
  to: z.string().min(1),
  condition: z.string().max(500).optional(),
});
const GraphSchema = z.object({
  nodes: z.array(NodeSpec).max(100),
  edges: z.array(EdgeSpec).max(300),
});

function toError(err: unknown): NextResponse {
  if (err instanceof HttpError)
    return NextResponse.json(err.toResponseBody(), { status: err.status });
  console.error("[api/workflows/graph]", err);
  return NextResponse.json(
    { error: { code: "INTERNAL_ERROR", message: "Internal error" } },
    { status: 500 }
  );
}

async function handlePost(request: NextRequest, ctx: Ctx) {
  try {
    const id = ctx.params?.id;
    if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });
    const parsed = GraphSchema.safeParse(await request.json());
    if (!parsed.success) {
      return NextResponse.json(
        { error: { code: "VALIDATION_FAILED", issues: parsed.error.issues } },
        { status: 400 }
      );
    }
    const scope = {
      userId: ctx.userId,
      workspaceId: ctx.workspaceId,
      role: ctx.role,
      source: ctx.agentTokenId ? ("agent" as const) : ("user" as const),
    };
    const workflowId = await resolveWorkflowId(id, scope);
    await requireWorkflowEdit(workflowId, scope);
    await setGraph(workflowId, parsed.data, scope);
    return new NextResponse(null, { status: 204 });
  } catch (err) {
    return toError(err);
  }
}

export const POST = withWorkspaceAuth(handlePost, { minRole: "member" });

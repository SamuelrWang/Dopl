import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { withWorkspaceAuth } from "@/shared/auth/with-workspace-auth";
import type { Role } from "@/features/workspaces/types";
import { HttpError } from "@/shared/lib/http-error";
import {
  requireWorkflowEdit,
  resolveWorkflowId,
} from "@/features/workflows/server/attachments";
import { connect, disconnect } from "@/features/workflows/server/authoring";

interface Ctx {
  userId: string;
  workspaceId: string;
  role: Role;
  agentTokenId?: string;
  params?: Record<string, string>;
}

// `condition` (a branch guard) applies to POST/connect only; DELETE ignores it.
const PairBody = z.object({
  from: z.string().min(1),
  to: z.string().min(1),
  condition: z.string().max(500).optional(),
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
  console.error("[api/workflows/edges]", err);
  return NextResponse.json(
    { error: { code: "INTERNAL_ERROR", message: "Internal error" } },
    { status: 500 }
  );
}

async function run(
  request: NextRequest,
  ctx: Ctx,
  op: "connect" | "disconnect"
): Promise<NextResponse> {
  try {
    const id = ctx.params?.id;
    if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });
    const parsed = PairBody.safeParse(await request.json());
    if (!parsed.success) {
      return NextResponse.json(
        { error: { code: "VALIDATION_FAILED", issues: parsed.error.issues } },
        { status: 400 }
      );
    }
    const scope = scopeOf(ctx);
    const workflowId = await resolveWorkflowId(id, scope);
    await requireWorkflowEdit(workflowId, scope);
    const { from, to, condition } = parsed.data;
    if (op === "connect") {
      await connect(workflowId, from, to, condition ?? "", scope);
    } else {
      await disconnect(workflowId, from, to, scope);
    }
    return new NextResponse(null, { status: 204 });
  } catch (err) {
    return toError(err);
  }
}

export const POST = withWorkspaceAuth(
  (request: NextRequest, ctx: Ctx) => run(request, ctx, "connect"),
  { minRole: "member" }
);
export const DELETE = withWorkspaceAuth(
  (request: NextRequest, ctx: Ctx) => run(request, ctx, "disconnect"),
  { minRole: "member" }
);

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { withWorkspaceAuth } from "@/shared/auth/with-workspace-auth";
import { HttpError } from "@/shared/lib/http-error";
import { denyIfNoCanvasWrite } from "@/features/members/server/access";
import { resolveWorkflowId } from "@/features/workflows/server/attachments";
import { connect, disconnect } from "@/features/workflows/server/authoring";

interface Ctx {
  userId: string;
  workspaceId: string;
  agentTokenId?: string;
  params?: Record<string, string>;
}

const PairBody = z.object({ from: z.string().min(1), to: z.string().min(1) });

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
  console.error("[api/workflows/edges]", err);
  return NextResponse.json(
    { error: { code: "INTERNAL_ERROR", message: "Internal error" } },
    { status: 500 }
  );
}

async function gate(ctx: Ctx): Promise<NextResponse | null> {
  return denyIfNoCanvasWrite({
    agentTokenId: ctx.agentTokenId,
    userId: ctx.userId,
    workspaceId: ctx.workspaceId,
  });
}

async function run(
  request: NextRequest,
  ctx: Ctx,
  op: "connect" | "disconnect"
): Promise<NextResponse> {
  try {
    const denied = await gate(ctx);
    if (denied) return denied;
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
    const fn = op === "connect" ? connect : disconnect;
    await fn(workflowId, parsed.data.from, parsed.data.to, scope);
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

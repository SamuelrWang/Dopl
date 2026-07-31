import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { DESCRIPTION_MAX } from "@/config";
import { graphLayoutSchema } from "@/shared/graph/layout-schema";
import { HttpError } from "@/shared/lib/http-error";
import { withWorkspaceAuth } from "@/shared/auth/with-workspace-auth";
import type { Role } from "@/features/workspaces/types";
import { WorkflowNameSchema } from "@/features/workflows/schema";
import {
  deleteWorkflow,
  getWorkflow,
  updateWorkflow,
} from "@/features/workflows/server/service";

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

// Mirrors the collection route's PostSchema caps so PATCH can't sneak an
// unbounded name (which becomes an unbounded slug) past validation. `layout`
// is the web-only draggable-node positions; the MCP update op never sends it
// (an optional field that agents simply omit).
const PatchSchema = z.object({
  name: WorkflowNameSchema.optional(),
  description: z.string().max(DESCRIPTION_MAX).nullable().optional(),
  clusterId: z.string().uuid().nullable().optional(),
  layout: graphLayoutSchema.optional(),
});

/**
 * HttpError → its own status/body; everything else → opaque 500 so raw
 * Supabase/Postgres messages (constraint names etc.) never reach clients.
 */
function toErrorResponse(err: unknown): NextResponse {
  if (err instanceof HttpError) {
    return NextResponse.json(err.toResponseBody(), { status: err.status });
  }
  console.error("[api/workflows/[id]]", err);
  return NextResponse.json(
    { error: { code: "INTERNAL_ERROR", message: "Internal error" } },
    { status: 500 }
  );
}

async function handleGet(_request: NextRequest, ctx: Ctx) {
  try {
    const id = ctx.params?.id;
    if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });
    const workflow = await getWorkflow(id, scopeOf(ctx));
    return NextResponse.json(workflow);
  } catch (error) {
    return toErrorResponse(error);
  }
}

async function handlePatch(request: NextRequest, ctx: Ctx) {
  try {
    const id = ctx.params?.id;
    if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });
    const parsed = PatchSchema.safeParse(await request.json());
    if (!parsed.success) {
      return NextResponse.json(
        { error: { code: "VALIDATION_FAILED", issues: parsed.error.issues } },
        { status: 400 }
      );
    }
    const workflow = await updateWorkflow(id, parsed.data, scopeOf(ctx));
    return NextResponse.json(workflow);
  } catch (error) {
    return toErrorResponse(error);
  }
}

async function handleDelete(_request: NextRequest, ctx: Ctx) {
  try {
    const id = ctx.params?.id;
    if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });
    await deleteWorkflow(id, scopeOf(ctx));
    return new NextResponse(null, { status: 204 });
  } catch (error) {
    return toErrorResponse(error);
  }
}

export const GET = withWorkspaceAuth(handleGet);
export const PATCH = withWorkspaceAuth(handlePatch, { minRole: "member" });
export const DELETE = withWorkspaceAuth(handleDelete, { minRole: "member" });

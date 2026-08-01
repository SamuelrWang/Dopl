import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { DESCRIPTION_MAX } from "@/config";
import { parseJson } from "@/shared/api/parse-json";
import { HttpError } from "@/shared/lib/http-error";
import { ClusterNameSchema } from "@/features/clusters/schema";
import type { Role } from "@/features/workspaces/types";
import { withWorkspaceAuth } from "@/shared/auth/with-workspace-auth";
import {
  deleteCluster,
  getCluster,
  updateCluster,
} from "@/features/clusters/server/service";

interface Ctx {
  userId: string;
  workspaceId: string;
  role: Role;
  agentTokenId?: string;
  params?: Record<string, string>;
}

/**
 * This PATCH — the rename path behind `dopl_cluster(op="update")` — had NO
 * schema at all. It hand-rolled `typeof body.name === "string"` and passed the
 * value straight through with no length bound, let alone a charset one, while
 * the sibling POST capped it at 120: create and rename disagreed about what a
 * cluster may be called, and rename was the one with no opinion. The name now
 * parses against the same schema the collection route uses.
 *
 * `description` keeps its EXISTING semantics deliberately — an over-long one is
 * CLIPPED here, not rejected, because that is what this route has always done
 * and callers may lean on it. Only the name's contract changes.
 */
const ClusterPatchSchema = z.object({
  name: ClusterNameSchema.optional(),
  description: z
    .string()
    .transform((d) => d.slice(0, DESCRIPTION_MAX))
    .nullable()
    .optional(),
});

function scopeOf(ctx: Ctx) {
  return {
    userId: ctx.userId,
    workspaceId: ctx.workspaceId,
    role: ctx.role,
    source: ctx.agentTokenId ? ("agent" as const) : ("user" as const),
  };
}

async function handleGet(_request: NextRequest, ctx: Ctx) {
  try {
    const slug = ctx.params?.slug;
    if (!slug) {
      return NextResponse.json({ error: "slug required" }, { status: 400 });
    }
    const cluster = await getCluster(slug, scopeOf(ctx));
    return NextResponse.json(cluster);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    const status = message.includes("not found") ? 404 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}

async function handlePatch(request: NextRequest, ctx: Ctx) {
  try {
    const slug = ctx.params?.slug;
    if (!slug) {
      return NextResponse.json({ error: "slug required" }, { status: 400 });
    }
    const patch = await parseJson(request, ClusterPatchSchema);
    const cluster = await updateCluster(
      slug,
      { name: patch.name, description: patch.description },
      scopeOf(ctx)
    );
    return NextResponse.json(cluster);
  } catch (error) {
    if (error instanceof HttpError) {
      return NextResponse.json(error.toResponseBody(), { status: error.status });
    }
    const message = error instanceof Error ? error.message : "Unknown error";
    const status = message.includes("not found") ? 404 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}

async function handleDelete(_request: NextRequest, ctx: Ctx) {
  try {
    const slug = ctx.params?.slug;
    if (!slug) {
      return NextResponse.json({ error: "slug required" }, { status: 400 });
    }
    await deleteCluster(slug, scopeOf(ctx));
    return new NextResponse(null, { status: 204 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    const status = message.includes("not found") ? 404 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}

export const GET = withWorkspaceAuth(handleGet);
export const PATCH = withWorkspaceAuth(handlePatch, { minRole: "member" });
export const DELETE = withWorkspaceAuth(handleDelete, { minRole: "member" });

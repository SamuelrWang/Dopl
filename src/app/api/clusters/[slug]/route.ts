import { NextRequest, NextResponse } from "next/server";
import { withWorkspaceAuth } from "@/shared/auth/with-workspace-auth";
import {
  deleteCluster,
  getCluster,
  updateCluster,
} from "@/features/clusters/server/service";

interface Ctx {
  userId: string;
  workspaceId: string;
  apiKeyId?: string;
  params?: Record<string, string>;
}

function scopeOf(ctx: Ctx) {
  return {
    userId: ctx.userId,
    workspaceId: ctx.workspaceId,
    source: ctx.apiKeyId ? ("agent" as const) : ("user" as const),
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
    const body = await request.json();
    const cluster = await updateCluster(
      slug,
      { name: body.name, entry_ids: body.entry_ids },
      scopeOf(ctx)
    );
    return NextResponse.json(cluster);
  } catch (error) {
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
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export const GET = withWorkspaceAuth(handleGet);
export const PATCH = withWorkspaceAuth(handlePatch, { minRole: "editor" });
export const DELETE = withWorkspaceAuth(handleDelete, { minRole: "editor" });

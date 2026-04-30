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
  params?: Record<string, string>;
}

async function handleGet(_request: NextRequest, { userId, workspaceId, params }: Ctx) {
  try {
    const slug = params?.slug;
    if (!slug) {
      return NextResponse.json({ error: "slug required" }, { status: 400 });
    }
    const cluster = await getCluster(slug, { userId, workspaceId });
    return NextResponse.json(cluster);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    const status = message.includes("not found") ? 404 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}

async function handlePatch(request: NextRequest, { userId, workspaceId, params }: Ctx) {
  try {
    const slug = params?.slug;
    if (!slug) {
      return NextResponse.json({ error: "slug required" }, { status: 400 });
    }
    const body = await request.json();
    const cluster = await updateCluster(
      slug,
      { name: body.name, entry_ids: body.entry_ids },
      { userId, workspaceId }
    );
    return NextResponse.json(cluster);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    const status = message.includes("not found") ? 404 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}

async function handleDelete(_request: NextRequest, { userId, workspaceId, params }: Ctx) {
  try {
    const slug = params?.slug;
    if (!slug) {
      return NextResponse.json({ error: "slug required" }, { status: 400 });
    }
    await deleteCluster(slug, { userId, workspaceId });
    return new NextResponse(null, { status: 204 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export const GET = withWorkspaceAuth(handleGet);
export const PATCH = withWorkspaceAuth(handlePatch, { minRole: "editor" });
export const DELETE = withWorkspaceAuth(handleDelete, { minRole: "editor" });

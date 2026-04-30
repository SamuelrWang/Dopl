import { NextRequest, NextResponse } from "next/server";
import { withCanvasAuth } from "@/shared/auth/with-canvas-auth";
import {
  deleteCluster,
  getCluster,
  updateCluster,
} from "@/features/clusters/server/service";

interface Ctx {
  userId: string;
  canvasId: string;
  params?: Record<string, string>;
}

async function handleGet(_request: NextRequest, { userId, canvasId, params }: Ctx) {
  try {
    const slug = params?.slug;
    if (!slug) {
      return NextResponse.json({ error: "slug required" }, { status: 400 });
    }
    const cluster = await getCluster(slug, { userId, canvasId });
    return NextResponse.json(cluster);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    const status = message.includes("not found") ? 404 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}

async function handlePatch(request: NextRequest, { userId, canvasId, params }: Ctx) {
  try {
    const slug = params?.slug;
    if (!slug) {
      return NextResponse.json({ error: "slug required" }, { status: 400 });
    }
    const body = await request.json();
    const cluster = await updateCluster(
      slug,
      { name: body.name, entry_ids: body.entry_ids },
      { userId, canvasId }
    );
    return NextResponse.json(cluster);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    const status = message.includes("not found") ? 404 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}

async function handleDelete(_request: NextRequest, { userId, canvasId, params }: Ctx) {
  try {
    const slug = params?.slug;
    if (!slug) {
      return NextResponse.json({ error: "slug required" }, { status: 400 });
    }
    await deleteCluster(slug, { userId, canvasId });
    return new NextResponse(null, { status: 204 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export const GET = withCanvasAuth(handleGet);
export const PATCH = withCanvasAuth(handlePatch, { minRole: "editor" });
export const DELETE = withCanvasAuth(handleDelete, { minRole: "editor" });

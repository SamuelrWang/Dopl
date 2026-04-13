import { NextRequest, NextResponse } from "next/server";
import { withExternalAuth } from "@/lib/auth/with-auth";
import { getCluster, updateCluster, deleteCluster } from "@/lib/clusters/service";

async function handleGet(
  _request: NextRequest,
  context: { params: Promise<{ slug: string }> }
) {
  try {
    const { slug } = await context.params;
    const cluster = await getCluster(slug);
    return NextResponse.json(cluster);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    const status = message.includes("not found") ? 404 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}

async function handlePatch(
  request: NextRequest,
  context: { params: Promise<{ slug: string }> }
) {
  try {
    const { slug } = await context.params;
    const body = await request.json();
    const cluster = await updateCluster(slug, {
      name: body.name,
      entry_ids: body.entry_ids,
    });
    return NextResponse.json(cluster);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    const status = message.includes("not found") ? 404 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}

async function handleDelete(
  _request: NextRequest,
  context: { params: Promise<{ slug: string }> }
) {
  try {
    const { slug } = await context.params;
    await deleteCluster(slug);
    return new NextResponse(null, { status: 204 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export const GET = withExternalAuth(handleGet);
export const PATCH = withExternalAuth(handlePatch);
export const DELETE = withExternalAuth(handleDelete);

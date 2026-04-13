import { NextRequest, NextResponse } from "next/server";
import { withExternalAuth } from "@/lib/auth/with-auth";
import { listClusters, createCluster } from "@/lib/clusters/service";

async function handleGet() {
  try {
    const clusters = await listClusters();
    return NextResponse.json({ clusters });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

async function handlePost(request: NextRequest) {
  try {
    const body = await request.json();
    const { name, entry_ids } = body;

    if (!name || typeof name !== "string") {
      return NextResponse.json(
        { error: "name is required" },
        { status: 400 }
      );
    }

    const cluster = await createCluster({
      name,
      entry_ids: Array.isArray(entry_ids) ? entry_ids : [],
    });

    return NextResponse.json(cluster, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export const GET = withExternalAuth(handleGet);
export const POST = withExternalAuth(handlePost);

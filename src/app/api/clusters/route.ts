import { NextRequest, NextResponse } from "next/server";
import { withUserAuth } from "@/lib/auth/with-auth";
import { listClusters, createCluster } from "@/lib/clusters/service";

async function handleGet(
  _request: NextRequest,
  { userId }: { userId: string }
) {
  try {
    const clusters = await listClusters({ userId });
    return NextResponse.json({ clusters });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

async function handlePost(
  request: NextRequest,
  { userId }: { userId: string }
) {
  try {
    const body = await request.json();
    const { name, entry_ids } = body;

    if (!name || typeof name !== "string") {
      return NextResponse.json(
        { error: "name is required" },
        { status: 400 }
      );
    }

    const cluster = await createCluster(
      {
        name,
        entry_ids: Array.isArray(entry_ids) ? entry_ids : [],
      },
      { userId }
    );

    return NextResponse.json(cluster, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export const GET = withUserAuth(handleGet);
export const POST = withUserAuth(handlePost);

import { NextRequest, NextResponse } from "next/server";
import { withUserAuth } from "@/shared/auth/with-auth";
import { publishCluster } from "@/features/community/server/service";

/**
 * POST /api/community/publish — Publish a cluster as a community post.
 *
 * Body: { cluster_id, title, description?, category? }
 */
async function handlePost(
  request: NextRequest,
  context: { userId: string }
) {
  try {
    const body = await request.json();
    const { cluster_id, title, description, category } = body;

    if (!cluster_id || typeof cluster_id !== "string") {
      return NextResponse.json(
        { error: "cluster_id is required" },
        { status: 400 }
      );
    }
    if (!title || typeof title !== "string") {
      return NextResponse.json(
        { error: "title is required" },
        { status: 400 }
      );
    }

    const published = await publishCluster(cluster_id, context.userId, {
      title,
      description,
      category,
    });

    return NextResponse.json(published, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    const status = message.includes("Not authorized") ? 403 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}

export const POST = withUserAuth(handlePost);

import { NextRequest, NextResponse } from "next/server";
import { withUserAuth } from "@/shared/auth/with-auth";
import { listMyPublishedClusters } from "@/features/community/server/service";

/**
 * GET /api/community/posts — List the current user's published clusters.
 * Requires auth.
 */
async function handleGet(
  _request: NextRequest,
  context: { userId: string }
) {
  try {
    const posts = await listMyPublishedClusters(context.userId);
    return NextResponse.json({ posts });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export const GET = withUserAuth(handleGet);

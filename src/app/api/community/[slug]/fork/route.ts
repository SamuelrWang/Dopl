import { NextRequest, NextResponse } from "next/server";
import { withUserAuth } from "@/lib/auth/with-auth";
import { forkPublishedCluster } from "@/features/community/server/service";

/**
 * POST /api/community/[slug]/fork — Import a published cluster into the user's canvas.
 * Creates a new cluster with copied entries and brain. Tracks lineage.
 */
const handlePost = withUserAuth(async (
  _request: NextRequest,
  context: { userId: string; params?: Record<string, string> }
) => {
  try {
    const slug = context.params?.slug;
    if (!slug) {
      return NextResponse.json({ error: "slug is required" }, { status: 400 });
    }

    const result = await forkPublishedCluster(slug, context.userId);

    return NextResponse.json(result, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    const status = message.includes("Not authorized") || message.includes("Cannot import")
      ? 403
      : message.includes("already imported")
        ? 409
        : message.includes("not found")
          ? 404
          : 500;
    return NextResponse.json({ error: message }, { status });
  }
});

export const POST = handlePost;

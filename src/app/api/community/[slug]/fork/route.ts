import { NextRequest, NextResponse } from "next/server";
import { withWorkspaceAuth } from "@/shared/auth/with-workspace-auth";
import { forkPublishedCluster } from "@/features/community/server/service";

/**
 * POST /api/community/[slug]/fork — Import a published cluster into the
 * caller's active canvas. Creates a new cluster with copied entries and
 * brain. Tracks lineage. Caller must have ≥ editor role on the active
 * canvas (forks are creative writes).
 */
const handlePost = withWorkspaceAuth(
  async (
    _request: NextRequest,
    context: {
      userId: string;
      workspaceId: string;
      params?: Record<string, string>;
    }
  ) => {
    try {
      const slug = context.params?.slug;
      if (!slug) {
        return NextResponse.json({ error: "slug is required" }, { status: 400 });
      }

      const result = await forkPublishedCluster(
        slug,
        context.userId,
        context.workspaceId
      );

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
  },
  { minRole: "editor" }
);

export const POST = handlePost;

import { NextRequest, NextResponse } from "next/server";
import { withUserAuth } from "@/lib/auth/with-auth";
import {
  getPublishedCluster,
  updatePublishedCluster,
  deletePublishedCluster,
} from "@/lib/community/service";

/**
 * GET /api/community/[slug] — Public detail endpoint.
 * No auth required. Returns full published cluster data.
 */
export async function GET(
  _request: NextRequest,
  context: { params: Promise<{ slug: string }> }
) {
  try {
    const { slug } = await context.params;
    const detail = await getPublishedCluster(slug);

    // Only allow public access to published posts
    if (detail.status !== "published") {
      return NextResponse.json(
        { error: "Not found" },
        { status: 404 }
      );
    }

    return NextResponse.json(detail);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    const status = message.includes("not found") ? 404 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}

/**
 * PATCH /api/community/[slug] — Update published cluster metadata.
 * Requires auth + ownership.
 *
 * Body: { title?, description?, category?, status? }
 */
const handlePatch = withUserAuth(async (
  request: NextRequest,
  context: { userId: string; params?: Record<string, string> }
) => {
  try {
    const slug = context.params?.slug;
    if (!slug) {
      return NextResponse.json({ error: "slug is required" }, { status: 400 });
    }

    const body = await request.json();
    const updated = await updatePublishedCluster(slug, context.userId, body);

    return NextResponse.json(updated);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    const status = message.includes("Not authorized")
      ? 403
      : message.includes("not found")
        ? 404
        : 500;
    return NextResponse.json({ error: message }, { status });
  }
});

/**
 * DELETE /api/community/[slug] — Archive a published cluster.
 * Requires auth + ownership.
 */
const handleDelete = withUserAuth(async (
  _request: NextRequest,
  context: { userId: string; params?: Record<string, string> }
) => {
  try {
    const slug = context.params?.slug;
    if (!slug) {
      return NextResponse.json({ error: "slug is required" }, { status: 400 });
    }

    await deletePublishedCluster(slug, context.userId);

    return NextResponse.json({ ok: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    const status = message.includes("Not authorized")
      ? 403
      : message.includes("not found")
        ? 404
        : 500;
    return NextResponse.json({ error: message }, { status });
  }
});

export const PATCH = handlePatch;
export const DELETE = handleDelete;

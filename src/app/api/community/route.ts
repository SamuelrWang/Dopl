import { NextRequest, NextResponse } from "next/server";
import { listPublishedClusters } from "@/lib/community/service";

/**
 * GET /api/community — Public gallery listing.
 * No auth required. Returns published clusters with author info.
 *
 * Query params: page, limit, sort (popular|newest), category
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = request.nextUrl;
    const page = parseInt(searchParams.get("page") || "1", 10);
    const limit = Math.min(parseInt(searchParams.get("limit") || "20", 10), 50);
    const sort = (searchParams.get("sort") as "popular" | "newest") || "newest";
    const category = searchParams.get("category") || undefined;

    const result = await listPublishedClusters({ page, limit, sort, category });

    return NextResponse.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

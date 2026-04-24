import { NextRequest, NextResponse } from "next/server";
import { listPublishedClusters, searchPublishedClusters } from "@/features/community/server/service";

/**
 * GET /api/community — Public gallery listing + search.
 * No auth required.
 *
 * Query params:
 *   - q: search query (triggers semantic search when present)
 *   - page, limit, sort (popular|newest), category: for listing mode
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = request.nextUrl;
    const query = searchParams.get("q")?.trim() || "";
    const limit = Math.min(parseInt(searchParams.get("limit") || "20", 10), 50);
    const category = searchParams.get("category") || undefined;

    // Semantic search mode
    if (query) {
      const items = await searchPublishedClusters({
        query,
        category,
        limit,
      });
      return NextResponse.json({ items, total: items.length });
    }

    // Listing mode
    const page = parseInt(searchParams.get("page") || "1", 10);
    const sort = (searchParams.get("sort") as "popular" | "newest") || "newest";

    const result = await listPublishedClusters({ page, limit, sort, category });

    return NextResponse.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

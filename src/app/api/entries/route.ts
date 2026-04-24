import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/shared/supabase/admin";
const supabase = supabaseAdmin();
import { withMcpCredits } from "@/shared/auth/with-auth";

async function handleGet(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const status = searchParams.get("status");
  const useCase = searchParams.get("use_case");
  const complexity = searchParams.get("complexity");
  const sourcePlatform = searchParams.get("source_platform");
  const sort = searchParams.get("sort") || "newest";
  const limit = parseInt(searchParams.get("limit") || "50", 10);
  const offset = parseInt(searchParams.get("offset") || "0", 10);

  let query = supabase
    .from("entries")
    .select("id, slug, title, summary, use_case, complexity, content_type, status, source_url, source_platform, source_author, thumbnail_url, created_at, ingested_at", { count: "exact" });

  if (sort === "oldest") {
    query = query.order("created_at", { ascending: true });
  } else if (sort === "alpha") {
    query = query.order("title", { ascending: true, nullsFirst: false });
  } else {
    // "newest" and unknown values fall through to the default
    query = query.order("created_at", { ascending: false });
  }

  query = query.range(offset, offset + limit - 1);

  // Only expose fully-ingested, admin-approved entries by default.
  // Callers can pass ?status=<anything> to override (e.g. admin/debug).
  query = query.eq("status", status || "complete");
  query = query.eq("moderation_status", "approved");
  if (useCase) query = query.eq("use_case", useCase);
  if (complexity) query = query.eq("complexity", complexity);
  if (sourcePlatform) query = query.eq("source_platform", sourcePlatform);

  const { data, error, count } = await query;

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({
    entries: data || [],
    total: count || 0,
    limit,
    offset,
  });
}

export const GET = withMcpCredits("mcp_list", handleGet);

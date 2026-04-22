import { NextResponse } from "next/server";
import { withMcpAccess } from "@/lib/auth/with-auth";
import { supabaseAdmin } from "@/lib/supabase";

const supabase = supabaseAdmin();

/**
 * GET /api/knowledge/packs/[packId]/files — list files in a pack.
 *
 * Returns metadata only (no body) so a single call is cheap regardless of
 * pack size. The agent calls /files/[...path] for the body it actually
 * needs. Mirrors the search → list → get progressive-disclosure pattern.
 *
 * Query: ?category=sdk&limit=50
 */
export const GET = withMcpAccess("kb_list", async (request, { params }) => {
  const packId = params?.packId;
  if (!packId) {
    return NextResponse.json({ error: "packId is required" }, { status: 400 });
  }

  const url = new URL(request.url);
  const category = url.searchParams.get("category");
  const limitRaw = url.searchParams.get("limit");
  const limit = Math.min(Math.max(parseInt(limitRaw ?? "50", 10) || 50, 1), 500);

  let query = supabase
    .from("knowledge_pack_files")
    .select("pack_id, path, title, summary, tags, category, updated_at")
    .eq("pack_id", packId)
    .order("path", { ascending: true })
    .limit(limit);

  if (category) query = query.eq("category", category);

  const { data, error } = await query;
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ pack_id: packId, files: data ?? [] });
});

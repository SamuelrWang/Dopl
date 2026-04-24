import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/shared/supabase/admin";
import { withAdminAuth } from "@/shared/auth/with-auth";

const supabase = supabaseAdmin();

/**
 * GET /api/admin/entries — list entries filtered by moderation state.
 * Admin-only. Default ?moderation_status=pending.
 * Joins ingester email via auth.users for display in the review UI.
 */
async function handleGet(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const moderationStatus = searchParams.get("moderation_status") || "pending";
  const limit = Math.min(parseInt(searchParams.get("limit") || "50", 10), 200);
  const offset = parseInt(searchParams.get("offset") || "0", 10);

  const { data: entries, error, count } = await supabase
    .from("entries")
    .select(
      "id, title, summary, source_url, source_platform, source_author, thumbnail_url, use_case, complexity, content_type, status, moderation_status, ingested_by, created_at, readme",
      { count: "exact" }
    )
    .eq("moderation_status", moderationStatus)
    .order("created_at", { ascending: false })
    .range(offset, offset + limit - 1);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  // Hydrate ingester emails via a follow-up select against auth.users.
  // Supabase doesn't let us join auth.users from a regular query.
  const ingesterIds = Array.from(
    new Set((entries || []).map((e) => e.ingested_by).filter((id): id is string => !!id))
  );

  const ingesterMap = new Map<string, string>();
  if (ingesterIds.length > 0) {
    // admin.listUsers is paginated; iterate until we've resolved all we need
    const { data: usersPage } = await supabase.auth.admin.listUsers({ perPage: 1000 });
    for (const u of usersPage?.users || []) {
      if (ingesterIds.includes(u.id)) ingesterMap.set(u.id, u.email || "(no email)");
    }
  }

  return NextResponse.json({
    entries: (entries || []).map((e) => ({
      ...e,
      ingester_email: e.ingested_by ? ingesterMap.get(e.ingested_by) || null : null,
    })),
    total: count || 0,
    limit,
    offset,
  });
}

export const GET = withAdminAuth(handleGet);

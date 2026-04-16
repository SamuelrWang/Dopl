import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { withAdminAuth } from "@/lib/auth/with-auth";

const supabase = supabaseAdmin();

/**
 * POST /api/admin/entries/[id]/approve — flip an entry to moderation_status='approved'.
 * Admin-only. The entry becomes visible in all public surfaces.
 */
async function handlePost(
  _request: NextRequest,
  { userId, params }: { userId: string; params?: Record<string, string> }
) {
  const id = params?.id;
  if (!id) {
    return NextResponse.json({ error: "Missing entry ID" }, { status: 400 });
  }

  const { error } = await supabase
    .from("entries")
    .update({
      moderation_status: "approved",
      moderated_at: new Date().toISOString(),
      moderated_by: userId,
      updated_at: new Date().toISOString(),
    })
    .eq("id", id);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return new NextResponse(null, { status: 204 });
}

export const POST = withAdminAuth(handlePost);

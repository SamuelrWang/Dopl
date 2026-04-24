import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { withAdminAuth } from "@/lib/auth/with-auth";
import { deleteFailedEntry } from "@/features/ingestion/server/pipeline";

const supabase = supabaseAdmin();

/**
 * POST /api/admin/entries/[id]/deny — flip an entry to moderation_status='denied'.
 * Admin-only.
 *
 * The entry row stays in the DB ONLY so the ingesting user's canvas keeps
 * working. If no canvas panel references this entry, we hard-delete it
 * immediately — no dead rows in the DB.
 */
async function handlePost(
  _request: NextRequest,
  { userId, params }: { userId: string; params?: Record<string, string> }
) {
  const id = params?.id;
  if (!id) {
    return NextResponse.json({ error: "Missing entry ID" }, { status: 400 });
  }

  // Check if any canvas panel references this entry before denying.
  const { count: refCount } = await supabase
    .from("canvas_panels")
    .select("id", { count: "exact", head: true })
    .eq("entry_id", id);

  if ((refCount ?? 0) === 0) {
    // No references — hard-delete immediately, no need to keep the row.
    await deleteFailedEntry(id);
    return new NextResponse(null, { status: 204 });
  }

  // At least one canvas panel references it — mark denied so owner's canvas works.
  const { error } = await supabase
    .from("entries")
    .update({
      moderation_status: "denied",
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

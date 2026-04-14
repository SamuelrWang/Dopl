import { NextRequest, NextResponse } from "next/server";
import { withUserAuth } from "@/lib/auth/with-auth";
import { supabaseAdmin } from "@/lib/supabase";

const supabase = supabaseAdmin();

/**
 * DELETE /api/conversations/[panelId] — delete a conversation by panel_id.
 * Also cleans up any associated chat attachments from storage.
 */
export const DELETE = withUserAuth(async (_request, { userId, params }) => {
  const panelId = params?.panelId;

  if (!panelId) {
    return NextResponse.json(
      { error: "panelId is required" },
      { status: 400 }
    );
  }

  // Clean up storage objects for attachments before deleting
  const { data: attachments } = await supabase
    .from("chat_attachments")
    .select("storage_path")
    .eq("user_id", userId)
    .eq("panel_id", panelId);

  if (attachments && attachments.length > 0) {
    const paths = attachments.map((a: { storage_path: string }) => a.storage_path);
    await supabase.storage.from("chat-attachments").remove(paths);
    await supabase
      .from("chat_attachments")
      .delete()
      .eq("user_id", userId)
      .eq("panel_id", panelId);
  }

  const { error } = await supabase
    .from("conversations")
    .delete()
    .eq("user_id", userId)
    .eq("panel_id", panelId);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return new NextResponse(null, { status: 204 });
});

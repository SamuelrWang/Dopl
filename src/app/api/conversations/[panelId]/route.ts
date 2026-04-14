import { NextRequest, NextResponse } from "next/server";
import { withUserAuth } from "@/lib/auth/with-auth";
import { supabaseAdmin } from "@/lib/supabase";

const supabase = supabaseAdmin();

/**
 * DELETE /api/conversations/[panelId] — delete a conversation by panel_id.
 */
export const DELETE = withUserAuth(async (_request, { userId, params }) => {
  const panelId = params?.panelId;

  if (!panelId) {
    return NextResponse.json(
      { error: "panelId is required" },
      { status: 400 }
    );
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

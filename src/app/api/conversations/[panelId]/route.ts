import { NextRequest, NextResponse } from "next/server";
import { withCanvasAuth } from "@/shared/auth/with-canvas-auth";
import { supabaseAdmin } from "@/shared/supabase/admin";

const supabase = supabaseAdmin();

/**
 * DELETE /api/conversations/[panelId] — delete a conversation by panel_id
 * within the active canvas. Also cleans up associated chat attachments
 * (still scoped by user_id today; canvas_id will be denormalized onto
 * chat_attachments in a future migration).
 */
export const DELETE = withCanvasAuth(
  async (_request, { userId, canvasId, params }) => {
    const panelId = params?.panelId;

    if (!panelId) {
      return NextResponse.json({ error: "panelId is required" }, { status: 400 });
    }

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
      .eq("canvas_id", canvasId)
      .eq("panel_id", panelId);

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return new NextResponse(null, { status: 204 });
  },
  { minRole: "editor" }
);

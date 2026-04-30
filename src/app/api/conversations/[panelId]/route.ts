import { NextResponse } from "next/server";
import { withWorkspaceAuth } from "@/shared/auth/with-workspace-auth";
import { supabaseAdmin } from "@/shared/supabase/admin";

const supabase = supabaseAdmin();

/**
 * DELETE /api/conversations/[panelId] — delete a conversation by panel_id
 * within the active workspace. Also cleans up associated chat attachments
 * (now scoped by workspace_id, so deletes fan out across all members'
 * uploads on the same panel).
 */
export const DELETE = withWorkspaceAuth(
  async (_request, { workspaceId, params }) => {
    const panelId = params?.panelId;

    if (!panelId) {
      return NextResponse.json({ error: "panelId is required" }, { status: 400 });
    }

    const { data: attachments } = await supabase
      .from("chat_attachments")
      .select("storage_path")
      .eq("workspace_id", workspaceId)
      .eq("panel_id", panelId);

    if (attachments && attachments.length > 0) {
      const paths = attachments.map((a: { storage_path: string }) => a.storage_path);
      await supabase.storage.from("chat-attachments").remove(paths);
      await supabase
        .from("chat_attachments")
        .delete()
        .eq("workspace_id", workspaceId)
        .eq("panel_id", panelId);
    }

    const { error } = await supabase
      .from("conversations")
      .delete()
      .eq("workspace_id", workspaceId)
      .eq("panel_id", panelId);

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return new NextResponse(null, { status: 204 });
  },
  { minRole: "editor" }
);

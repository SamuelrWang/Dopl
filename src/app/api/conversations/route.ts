import { NextRequest, NextResponse } from "next/server";
import { withCanvasAuth } from "@/shared/auth/with-canvas-auth";
import { supabaseAdmin } from "@/shared/supabase/admin";

const supabase = supabaseAdmin();

/**
 * GET /api/conversations — list all conversations on the active canvas.
 * Also cleans up expired unpinned conversations and their attachments
 * on each fetch.
 */
export const GET = withCanvasAuth(async (_request, { userId, canvasId }) => {
  // Find expired unpinned conversations before deleting (need panel_ids
  // for attachment cleanup).
  const { data: expiring } = await supabase
    .from("conversations")
    .select("id, panel_id")
    .eq("canvas_id", canvasId)
    .eq("pinned", false)
    .lt("expires_at", new Date().toISOString());

  if (expiring && expiring.length > 0) {
    const panelIds = expiring.map((c: { panel_id: string }) => c.panel_id);

    // Storage attachments are still keyed by user_id today; safe because
    // each user has one canvas during P0/P1. Migrate to canvas_id when
    // chat_attachments gets a denorm column.
    const { data: attachments } = await supabase
      .from("chat_attachments")
      .select("storage_path")
      .eq("user_id", userId)
      .in("panel_id", panelIds);

    if (attachments && attachments.length > 0) {
      const paths = attachments.map(
        (a: { storage_path: string }) => a.storage_path
      );
      await supabase.storage.from("chat-attachments").remove(paths);
      await supabase
        .from("chat_attachments")
        .delete()
        .eq("user_id", userId)
        .in("panel_id", panelIds);
    }

    await supabase
      .from("conversations")
      .delete()
      .eq("canvas_id", canvasId)
      .eq("pinned", false)
      .lt("expires_at", new Date().toISOString());
  }

  const { data, error } = await supabase
    .from("conversations")
    .select("id, panel_id, title, messages, pinned, expires_at, created_at, updated_at")
    .eq("canvas_id", canvasId)
    .order("updated_at", { ascending: false });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ conversations: data || [] });
});

/**
 * POST /api/conversations — upsert a conversation.
 * Body: { panel_id, title, messages, pinned? }
 */
export const POST = withCanvasAuth(
  async (request, { userId, canvasId }) => {
    const body = await request.json();
    const { panel_id, title, messages, pinned } = body;

    if (!panel_id || typeof panel_id !== "string") {
      return NextResponse.json({ error: "panel_id is required" }, { status: 400 });
    }

    if (!Array.isArray(messages)) {
      return NextResponse.json(
        { error: "messages must be an array" },
        { status: 400 }
      );
    }

    const now = new Date();
    const expiresAt = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);

    const { data, error } = await supabase
      .from("conversations")
      .upsert(
        {
          user_id: userId,
          canvas_id: canvasId,
          panel_id,
          title: title || "New Chat",
          messages,
          pinned: pinned ?? false,
          updated_at: now.toISOString(),
          expires_at: expiresAt.toISOString(),
        },
        { onConflict: "canvas_id,panel_id" }
      )
      .select(
        "id, panel_id, title, messages, pinned, expires_at, created_at, updated_at"
      )
      .single();

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ conversation: data });
  },
  { minRole: "editor" }
);

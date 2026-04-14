import { NextRequest, NextResponse } from "next/server";
import { withUserAuth } from "@/lib/auth/with-auth";
import { supabaseAdmin } from "@/lib/supabase";

const supabase = supabaseAdmin();

/**
 * GET /api/conversations — list all conversations for the authenticated user.
 * Also cleans up expired unpinned conversations on each fetch.
 */
export const GET = withUserAuth(async (_request, { userId }) => {
  // Clean up expired unpinned conversations (best-effort)
  await supabase
    .from("conversations")
    .delete()
    .eq("user_id", userId)
    .eq("pinned", false)
    .lt("expires_at", new Date().toISOString())
    .then(() => {});

  const { data, error } = await supabase
    .from("conversations")
    .select("id, panel_id, title, messages, pinned, expires_at, created_at, updated_at")
    .eq("user_id", userId)
    .order("updated_at", { ascending: false });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ conversations: data || [] });
});

/**
 * POST /api/conversations — upsert a conversation.
 * Body: { panel_id: string, title: string, messages: Array<{role, content}>, pinned?: boolean }
 */
export const POST = withUserAuth(async (request, { userId }) => {
  const body = await request.json();
  const { panel_id, title, messages, pinned } = body;

  if (!panel_id || typeof panel_id !== "string") {
    return NextResponse.json(
      { error: "panel_id is required" },
      { status: 400 }
    );
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
        panel_id,
        title: title || "New Chat",
        messages,
        pinned: pinned ?? false,
        updated_at: now.toISOString(),
        expires_at: expiresAt.toISOString(),
      },
      { onConflict: "user_id,panel_id" }
    )
    .select("id, panel_id, title, messages, pinned, expires_at, created_at, updated_at")
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ conversation: data });
});

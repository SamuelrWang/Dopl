import { NextRequest, NextResponse } from "next/server";
import { withUserAuth } from "@/lib/auth/with-auth";
import { supabaseAdmin } from "@/lib/supabase";

const supabase = supabaseAdmin();

/**
 * PATCH /api/canvas/panels/[panelId] — update a panel's position, size, or data.
 */
export const PATCH = withUserAuth(async (request, { userId, params }) => {
  const panelId = params?.panelId;
  if (!panelId) {
    return NextResponse.json({ error: "panelId is required" }, { status: 400 });
  }

  const body = await request.json();
  const update: Record<string, unknown> = {};

  if (body.x !== undefined) update.x = body.x;
  if (body.y !== undefined) update.y = body.y;
  if (body.width !== undefined) update.width = body.width;
  if (body.height !== undefined) update.height = body.height;
  if (body.title !== undefined) update.title = body.title;
  if (body.panel_data !== undefined) update.panel_data = body.panel_data;

  if (Object.keys(update).length === 0) {
    return NextResponse.json({ error: "No fields to update" }, { status: 400 });
  }

  const { error } = await supabase
    .from("canvas_panels")
    .update(update)
    .eq("user_id", userId)
    .eq("panel_id", panelId);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ success: true });
});

/**
 * DELETE /api/canvas/panels/[panelId] — remove a panel from the user's canvas.
 * Accepts either a panel_id (e.g., "entry-5") or an entry_id (UUID) for
 * backward compatibility with the chrome extension and MCP server.
 */
export const DELETE = withUserAuth(async (_request, { userId, params }) => {
  const panelId = params?.panelId;
  if (!panelId) {
    return NextResponse.json({ error: "panelId is required" }, { status: 400 });
  }

  // Try deleting by panel_id first (new callers: use-canvas-db-sync)
  const { data: byPanelId, error: err1 } = await supabase
    .from("canvas_panels")
    .delete()
    .eq("user_id", userId)
    .eq("panel_id", panelId)
    .select("id");

  if (err1) {
    return NextResponse.json({ error: err1.message }, { status: 500 });
  }

  if (byPanelId && byPanelId.length > 0) {
    return new NextResponse(null, { status: 204 });
  }

  // Fallback: try deleting by entry_id (legacy callers: chrome extension, MCP server)
  const { data: byEntryId, error: err2 } = await supabase
    .from("canvas_panels")
    .delete()
    .eq("user_id", userId)
    .eq("entry_id", panelId)
    .select("id");

  if (err2) {
    return NextResponse.json({ error: err2.message }, { status: 500 });
  }

  if (byEntryId && byEntryId.length > 0) {
    return new NextResponse(null, { status: 204 });
  }

  return new NextResponse(null, { status: 204 });
});

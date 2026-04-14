import { NextRequest, NextResponse } from "next/server";
import { withUserAuth } from "@/lib/auth/with-auth";
import { supabaseAdmin } from "@/lib/supabase";

const supabase = supabaseAdmin();

/**
 * GET /api/canvas/state — returns full canvas state from DB.
 * Returns 404 if no canvas_state row exists (triggers client-side migration).
 */
export const GET = withUserAuth(async (_request, { userId }) => {
  const { data: canvasState, error: stateError } = await supabase
    .from("canvas_state")
    .select("*")
    .eq("user_id", userId)
    .maybeSingle();

  if (stateError) {
    return NextResponse.json({ error: stateError.message }, { status: 500 });
  }

  if (!canvasState) {
    return NextResponse.json({ error: "No canvas state found" }, { status: 404 });
  }

  const { data: panels, error: panelsError } = await supabase
    .from("canvas_panels")
    .select("*")
    .eq("user_id", userId);

  if (panelsError) {
    return NextResponse.json({ error: panelsError.message }, { status: 500 });
  }

  return NextResponse.json({
    canvas_state: canvasState,
    panels: panels || [],
  });
});

/**
 * PATCH /api/canvas/state — partial update of canvas meta.
 * Uses upsert so it works even if the row doesn't exist yet.
 */
export const PATCH = withUserAuth(async (request, { userId }) => {
  const body = await request.json();
  const update: Record<string, unknown> = { updated_at: new Date().toISOString() };

  if (body.camera_x !== undefined) update.camera_x = body.camera_x;
  if (body.camera_y !== undefined) update.camera_y = body.camera_y;
  if (body.camera_zoom !== undefined) update.camera_zoom = body.camera_zoom;
  if (body.next_panel_id !== undefined) update.next_panel_id = body.next_panel_id;
  if (body.next_cluster_id !== undefined) update.next_cluster_id = body.next_cluster_id;
  if (body.sidebar_open !== undefined) update.sidebar_open = body.sidebar_open;

  const { error } = await supabase
    .from("canvas_state")
    .upsert(
      { user_id: userId, ...update },
      { onConflict: "user_id" }
    );

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ success: true });
});

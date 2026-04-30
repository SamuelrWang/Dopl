import { NextRequest, NextResponse } from "next/server";
import { withCanvasAuth } from "@/shared/auth/with-canvas-auth";
import { supabaseAdmin } from "@/shared/supabase/admin";

const supabase = supabaseAdmin();

/**
 * GET /api/canvas/state — full canvas state for the active canvas.
 * Returns 404 if no canvas_state row exists yet (triggers the client-
 * side localStorage migration). The response carries the row's monotonic
 * `version` so the client can stamp PATCHes with `if_version` and the
 * server can reject stale writes with 409.
 */
export const GET = withCanvasAuth(async (_request, { canvasId }) => {
  const { data: canvasState, error: stateError } = await supabase
    .from("canvas_state")
    .select("*")
    .eq("canvas_id", canvasId)
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
    .eq("canvas_id", canvasId);

  if (panelsError) {
    return NextResponse.json({ error: panelsError.message }, { status: 500 });
  }

  return NextResponse.json({
    canvas_state: canvasState,
    panels: panels || [],
  });
});

/**
 * PATCH /api/canvas/state — partial update of the active canvas's
 * state. Optional `if_version` body field (sent by useCanvasDbSync)
 * gates the write: if the current row's version doesn't match, return
 * 409 and the latest snapshot so the client can refetch + retry.
 */
export const PATCH = withCanvasAuth(
  async (request, { userId, canvasId }) => {
    const body = await request.json();
    const update: Record<string, unknown> = { updated_at: new Date().toISOString() };

    if (body.camera_x !== undefined) update.camera_x = body.camera_x;
    if (body.camera_y !== undefined) update.camera_y = body.camera_y;
    if (body.camera_zoom !== undefined) update.camera_zoom = body.camera_zoom;
    if (body.next_panel_id !== undefined) update.next_panel_id = body.next_panel_id;
    if (body.next_cluster_id !== undefined) update.next_cluster_id = body.next_cluster_id;
    if (body.sidebar_open !== undefined) update.sidebar_open = body.sidebar_open;
    if (body.clusters !== undefined) update.clusters = body.clusters;

    const expectedVersion: number | null =
      typeof body.if_version === "number" ? body.if_version : null;

    // Fast-path INSERT: the row may not exist yet for a brand-new
    // canvas. UPSERT below handles that, but the if_version check has
    // to skip the optimistic-lock branch when there's no row to clash
    // with — version=null means "I don't have a baseline yet, just
    // write it."
    if (expectedVersion !== null) {
      const { data: current } = await supabase
        .from("canvas_state")
        .select("version")
        .eq("canvas_id", canvasId)
        .maybeSingle();
      if (current && current.version !== expectedVersion) {
        const { data: fresh } = await supabase
          .from("canvas_state")
          .select("*")
          .eq("canvas_id", canvasId)
          .maybeSingle();
        return NextResponse.json(
          {
            error: {
              code: "STALE_VERSION",
              message:
                "canvas_state has been updated since the client's last fetch — refetch + retry.",
            },
            current: fresh,
          },
          { status: 409 }
        );
      }
    }

    const { data: updated, error } = await supabase
      .from("canvas_state")
      .upsert(
        { user_id: userId, canvas_id: canvasId, ...update },
        { onConflict: "canvas_id" }
      )
      .select("version")
      .maybeSingle();

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({
      success: true,
      version: updated?.version ?? null,
    });
  },
  { minRole: "editor" }
);

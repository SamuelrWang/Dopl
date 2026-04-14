import { NextRequest, NextResponse } from "next/server";
import { withUserAuth } from "@/lib/auth/with-auth";
import { supabaseAdmin } from "@/lib/supabase";

const supabase = supabaseAdmin();

interface MigratePanel {
  panel_id: string;
  panel_type: string;
  entry_id?: string | null;
  x: number;
  y: number;
  width: number;
  height: number;
  title?: string;
  summary?: string | null;
  source_url?: string;
  panel_data?: Record<string, unknown>;
}

/**
 * POST /api/canvas/state/migrate — one-time bulk migration from localStorage.
 * Creates canvas_state row + inserts all panels. Idempotent (upserts).
 */
export const POST = withUserAuth(async (request, { userId }) => {
  try {
    const body = await request.json();

    // Upsert canvas_state
    const { error: stateError } = await supabase
      .from("canvas_state")
      .upsert(
        {
          user_id: userId,
          camera_x: body.camera_x ?? 0,
          camera_y: body.camera_y ?? 0,
          camera_zoom: body.camera_zoom ?? 1,
          next_panel_id: body.next_panel_id ?? 1,
          next_cluster_id: body.next_cluster_id ?? 1,
          sidebar_open: body.sidebar_open ?? false,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "user_id" }
      );

    if (stateError) {
      return NextResponse.json({ error: stateError.message }, { status: 500 });
    }

    // Insert panels (skip any that already exist via upsert)
    const panels: MigratePanel[] = Array.isArray(body.panels) ? body.panels : [];
    if (panels.length > 0) {
      const rows = panels.map((p) => ({
        user_id: userId,
        panel_id: p.panel_id,
        panel_type: p.panel_type || "entry",
        entry_id: p.entry_id || null,
        x: p.x ?? 0,
        y: p.y ?? 0,
        width: p.width ?? null,
        height: p.height ?? null,
        title: p.title || null,
        summary: p.summary || null,
        source_url: p.source_url || null,
        panel_data: p.panel_data || {},
      }));

      const { error: panelsError } = await supabase
        .from("canvas_panels")
        .upsert(rows, { onConflict: "user_id,panel_id", ignoreDuplicates: true });

      if (panelsError) {
        console.error("[migrate] Panel insert error:", panelsError);
        // Non-fatal — canvas_state was created, panels can be re-synced
      }
    }

    return NextResponse.json({ success: true, panelCount: panels.length });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
});

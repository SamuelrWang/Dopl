import { NextResponse } from "next/server";
import { withWorkspaceAuth } from "@/shared/auth/with-workspace-auth";
import { supabaseAdmin } from "@/shared/supabase/admin";
import { denyIfNoCanvasWrite } from "@/features/members/server/access";

const supabase = supabaseAdmin();

interface MigratePanel {
  panel_id: string;
  panel_type: string;
  x: number;
  y: number;
  width: number;
  height: number;
  title?: string;
  summary?: string | null;
  source_url?: string;
  panel_data?: Record<string, unknown>;
}

const VALID_PANEL_TYPES = new Set([
  "chat",
  "connection",
  "knowledge",
  "skills",
  "knowledge-base",
  "skill",
  "artifact",
]);

/**
 * POST /api/canvas/state/migrate — bulk import from localStorage into
 * the active canvas. Idempotent (upserts).
 */
export const POST = withWorkspaceAuth(
  async (request, { userId, workspaceId, agentTokenId }) => {
    try {
      const denied = await denyIfNoCanvasWrite({ agentTokenId, userId, workspaceId });
      if (denied) return denied;

      const body = await request.json();

      const { error: stateError } = await supabase.from("canvas_state").upsert(
        {
          user_id: userId,
          workspace_id: workspaceId,
          camera_x: body.camera_x ?? 0,
          camera_y: body.camera_y ?? 0,
          camera_zoom: body.camera_zoom ?? 1,
          next_panel_id: body.next_panel_id ?? 1,
          sidebar_open: body.sidebar_open ?? false,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "workspace_id" }
      );

      if (stateError) {
        return NextResponse.json({ error: stateError.message }, { status: 500 });
      }

      const allPanels: MigratePanel[] = Array.isArray(body.panels) ? body.panels : [];
      // Drop any legacy panel types that no longer exist (e.g. 'entry',
      // 'browse') — they'd violate the canvas_panels panel_type CHECK.
      const panels = allPanels.filter((p) => VALID_PANEL_TYPES.has(p.panel_type));
      if (panels.length > 0) {
        const rows = panels.map((p) => ({
          user_id: userId,
          workspace_id: workspaceId,
          panel_id: p.panel_id,
          panel_type: p.panel_type,
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
          .upsert(rows, { onConflict: "workspace_id,panel_id", ignoreDuplicates: true });

        if (panelsError) {
          console.error("[migrate] Panel insert error:", panelsError);
          // Non-fatal — canvas_state was created, panels can be re-synced.
        }
      }

      return NextResponse.json({ success: true, panelCount: panels.length });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      return NextResponse.json({ error: message }, { status: 500 });
    }
  },
  { minRole: "member" }
);

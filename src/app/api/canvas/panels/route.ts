import { NextResponse } from "next/server";
import { withWorkspaceAuth } from "@/shared/auth/with-workspace-auth";
import { supabaseAdmin } from "@/shared/supabase/admin";
import { denyIfNoCanvasWrite } from "@/features/members/server/access";

const supabase = supabaseAdmin();

/**
 * GET /api/canvas/panels — list all panels on the active canvas.
 */
export const GET = withWorkspaceAuth(async (_request, { workspaceId }) => {
  const { data, error } = await supabase
    .from("canvas_panels")
    .select("*")
    .eq("workspace_id", workspaceId)
    .order("added_at", { ascending: false });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const panels = (data || []).map((p) => ({ ...p, slug: null as string | null }));

  return NextResponse.json({ panels });
});

/**
 * POST /api/canvas/panels — add a panel to the active canvas.
 * Supported panel types: chat, connection, knowledge, skills,
 * knowledge-base, skill, artifact.
 * Body: { panel_id, panel_type, x, y, width?, height?, title?, summary?, source_url?, panel_data? }
 */
export const POST = withWorkspaceAuth(
  async (request, { userId, workspaceId, apiKeyId }) => {
    const denied = await denyIfNoCanvasWrite({ apiKeyId, userId, workspaceId });
    if (denied) return denied;

    const body = await request.json();
    const { panel_type, x, y, width, height, title, summary, source_url, panel_data } = body;
    const { panel_id } = body;

    if (!panel_id || typeof panel_id !== "string") {
      return NextResponse.json({ error: "panel_id is required" }, { status: 400 });
    }

    // Allow-list MUST mirror the discriminated union in
    // src/features/canvas/types.ts and the cases in panel-dto.ts.
    // When adding a new panel type, update all three sites.
    const VALID_PANEL_TYPES = [
      "chat",
      "connection",
      "knowledge",
      "skills",
      "knowledge-base",
      "skill",
      "artifact",
    ];
    if (!panel_type || !VALID_PANEL_TYPES.includes(panel_type)) {
      return NextResponse.json(
        { error: `Invalid panel_type. Must be one of: ${VALID_PANEL_TYPES.join(", ")}` },
        { status: 400 }
      );
    }

    const { data: panel, error: insertError } = await supabase
      .from("canvas_panels")
      .upsert(
        {
          user_id: userId,
          workspace_id: workspaceId,
          panel_id,
          panel_type,
          x: x ?? 0,
          y: y ?? 0,
          width: width ?? null,
          height: height ?? null,
          title: title || null,
          summary: summary || null,
          source_url: source_url || null,
          panel_data: panel_data || {},
        },
        { onConflict: "workspace_id,panel_id", ignoreDuplicates: true }
      )
      .select()
      .maybeSingle();

    if (insertError) {
      const { data: existing } = await supabase
        .from("canvas_panels")
        .select("*")
        .eq("workspace_id", workspaceId)
        .eq("panel_id", panel_id)
        .single();

      if (existing) {
        return NextResponse.json({ panel: existing, created: false });
      }

      return NextResponse.json({ error: insertError.message }, { status: 500 });
    }

    return NextResponse.json({ panel, created: true }, { status: 201 });
  },
  { minRole: "member" }
);

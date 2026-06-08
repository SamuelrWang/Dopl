import { NextResponse } from "next/server";
import { withWorkspaceAuth } from "@/shared/auth/with-workspace-auth";
import { supabaseAdmin } from "@/shared/supabase/admin";
import { denyIfNoCanvasWrite } from "@/features/members/server/access";

const supabase = supabaseAdmin();

/**
 * PATCH /api/canvas/panels/[panelId] — update a panel's position, size, or data.
 */
export const PATCH = withWorkspaceAuth(
  async (request, { userId, workspaceId, apiKeyId, params }) => {
    const denied = await denyIfNoCanvasWrite({ apiKeyId, userId, workspaceId });
    if (denied) return denied;

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
      .eq("workspace_id", workspaceId)
      .eq("panel_id", panelId);

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ success: true });
  },
  { minRole: "member" }
);

/**
 * DELETE /api/canvas/panels/[panelId] — remove a panel from the user's canvas
 * by its panel_id.
 */
export const DELETE = withWorkspaceAuth(
  async (_request, { userId, workspaceId, apiKeyId, params }) => {
    const denied = await denyIfNoCanvasWrite({ apiKeyId, userId, workspaceId });
    if (denied) return denied;

    const panelId = params?.panelId;
    if (!panelId) {
      return NextResponse.json({ error: "panelId is required" }, { status: 400 });
    }

    const { error } = await supabase
      .from("canvas_panels")
      .delete()
      .eq("workspace_id", workspaceId)
      .eq("panel_id", panelId);

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return new NextResponse(null, { status: 204 });
  },
  { minRole: "member" }
);

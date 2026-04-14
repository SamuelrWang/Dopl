import { NextRequest, NextResponse } from "next/server";
import { withUserAuth } from "@/lib/auth/with-auth";
import { supabaseAdmin } from "@/lib/supabase";

const supabase = supabaseAdmin();

/**
 * PATCH /api/canvas/panels/batch — batch update panel positions.
 * Body: { updates: [{ panel_id, x, y }] }
 */
export const PATCH = withUserAuth(async (request, { userId }) => {
  const body = await request.json();
  const updates: Array<{ panel_id: string; x: number; y: number }> =
    Array.isArray(body.updates) ? body.updates : [];

  if (updates.length === 0) {
    return NextResponse.json({ error: "No updates provided" }, { status: 400 });
  }

  // Update each panel position (parallel, best-effort)
  const results = await Promise.allSettled(
    updates.map((u) =>
      supabase
        .from("canvas_panels")
        .update({ x: u.x, y: u.y })
        .eq("user_id", userId)
        .eq("panel_id", u.panel_id)
    )
  );

  const failCount = results.filter((r) => r.status === "rejected").length;

  return NextResponse.json({
    success: true,
    updated: updates.length - failCount,
    failed: failCount,
  });
});

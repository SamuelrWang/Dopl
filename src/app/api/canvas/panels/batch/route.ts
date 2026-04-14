import { NextRequest, NextResponse } from "next/server";
import { withUserAuth } from "@/lib/auth/with-auth";
import { supabaseAdmin } from "@/lib/supabase";

const supabase = supabaseAdmin();

/**
 * PATCH /api/canvas/panels/batch — batch update panel fields.
 * Body: { updates: [{ panel_id, x?, y?, title? }] }
 */
export const PATCH = withUserAuth(async (request, { userId }) => {
  const body = await request.json();
  const updates: Array<{ panel_id: string; x?: number; y?: number; title?: string }> =
    Array.isArray(body.updates) ? body.updates : [];

  if (updates.length === 0) {
    return NextResponse.json({ error: "No updates provided" }, { status: 400 });
  }

  // Update each panel (parallel, best-effort)
  const results = await Promise.allSettled(
    updates.map((u) => {
      const fields: Record<string, unknown> = {};
      if (u.x !== undefined) fields.x = u.x;
      if (u.y !== undefined) fields.y = u.y;
      if (u.title !== undefined) fields.title = u.title;
      if (Object.keys(fields).length === 0) return Promise.resolve();
      return supabase
        .from("canvas_panels")
        .update(fields)
        .eq("user_id", userId)
        .eq("panel_id", u.panel_id);
    })
  );

  const failCount = results.filter((r) => r.status === "rejected").length;

  return NextResponse.json({
    success: true,
    updated: updates.length - failCount,
    failed: failCount,
  });
});

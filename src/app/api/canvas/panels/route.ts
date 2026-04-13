import { NextRequest, NextResponse } from "next/server";
import { withUserAuth } from "@/lib/auth/with-auth";
import { supabaseAdmin } from "@/lib/supabase";

const supabase = supabaseAdmin();

/**
 * GET /api/canvas/panels — list all entry panels on the user's canvas.
 */
export const GET = withUserAuth(async (_request, { userId }) => {
  const { data, error } = await supabase
    .from("canvas_panels")
    .select("id, entry_id, title, summary, source_url, x, y, added_at")
    .eq("user_id", userId)
    .order("added_at", { ascending: false });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ panels: data || [] });
});

/**
 * POST /api/canvas/panels — add an entry to the user's canvas.
 * Body: { entry_id: string }
 */
export const POST = withUserAuth(async (request, { userId }) => {
  const body = await request.json();
  const entryId = body.entry_id;

  if (!entryId || typeof entryId !== "string") {
    return NextResponse.json(
      { error: "entry_id is required" },
      { status: 400 }
    );
  }

  // Validate entry exists and is complete
  const { data: entry, error: entryError } = await supabase
    .from("entries")
    .select("id, title, summary, source_url, status")
    .eq("id", entryId)
    .single();

  if (entryError || !entry) {
    return NextResponse.json({ error: "Entry not found" }, { status: 404 });
  }

  if (entry.status !== "complete") {
    return NextResponse.json(
      { error: "Entry is not yet complete", status: entry.status },
      { status: 422 }
    );
  }

  // Compute position: place to the right of the rightmost existing panel
  const { data: existing } = await supabase
    .from("canvas_panels")
    .select("x")
    .eq("user_id", userId)
    .order("x", { ascending: false })
    .limit(1);

  const PANEL_WIDTH = 420;
  const GAP = 40;
  const x = existing && existing.length > 0 ? existing[0].x + PANEL_WIDTH + GAP : 0;
  const y = 0;

  // Insert (idempotent — ON CONFLICT DO NOTHING)
  const { data: panel, error: insertError } = await supabase
    .from("canvas_panels")
    .upsert(
      {
        user_id: userId,
        entry_id: entryId,
        title: entry.title,
        summary: entry.summary,
        source_url: entry.source_url,
        x,
        y,
      },
      { onConflict: "user_id,entry_id", ignoreDuplicates: true }
    )
    .select()
    .single();

  if (insertError) {
    // If ignoreDuplicates caused no row returned, fetch the existing one
    const { data: existingPanel } = await supabase
      .from("canvas_panels")
      .select("id, entry_id, title, summary, source_url, x, y, added_at")
      .eq("user_id", userId)
      .eq("entry_id", entryId)
      .single();

    if (existingPanel) {
      return NextResponse.json({ panel: existingPanel, created: false });
    }

    return NextResponse.json({ error: insertError.message }, { status: 500 });
  }

  return NextResponse.json({ panel, created: true }, { status: 201 });
});

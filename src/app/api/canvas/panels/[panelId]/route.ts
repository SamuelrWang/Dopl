import { NextRequest, NextResponse } from "next/server";
import { withUserAuth } from "@/lib/auth/with-auth";
import { supabaseAdmin } from "@/lib/supabase";
import { deleteFailedEntry } from "@/lib/ingestion/pipeline";

const supabase = supabaseAdmin();

/**
 * After a canvas panel referencing an entry is deleted, check whether any
 * other canvas_panels row (across all users) still references the entry.
 * If not AND the entry is denied, hard-delete it — there's no reader left
 * and denied entries aren't allowed to persist without an owner's canvas
 * keeping them alive.
 *
 * Fire-and-forget from the DELETE handler — any failure is logged but
 * doesn't block the user's response.
 */
async function cleanupOrphanDeniedEntry(entryId: string): Promise<void> {
  try {
    const { count: refCount } = await supabase
      .from("canvas_panels")
      .select("id", { count: "exact", head: true })
      .eq("entry_id", entryId);

    if ((refCount ?? 0) > 0) return;

    const { data: entry } = await supabase
      .from("entries")
      .select("moderation_status")
      .eq("id", entryId)
      .single();

    if (entry?.moderation_status === "denied") {
      await deleteFailedEntry(entryId);
    }
  } catch (err) {
    console.error("[canvas-panels] orphan cleanup failed:", err);
  }
}

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
 * Accepts panel_id (e.g. "entry-<uuid>"), an entry_id UUID, OR an entry slug
 * (MCP's canvas_remove_entry tool advertises slug support). Resolution
 * order: panel_id → slug → entry_id UUID fallback.
 */
const UUID_REGEX = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

export const DELETE = withUserAuth(async (_request, { userId, params }) => {
  const panelId = params?.panelId;
  if (!panelId) {
    return NextResponse.json({ error: "panelId is required" }, { status: 400 });
  }

  // Try deleting by panel_id first (new callers: use-canvas-db-sync).
  // Select entry_id so we can cleanup orphan denied entries afterwards.
  const { data: byPanelId, error: err1 } = await supabase
    .from("canvas_panels")
    .delete()
    .eq("user_id", userId)
    .eq("panel_id", panelId)
    .select("id, entry_id");

  if (err1) {
    return NextResponse.json({ error: err1.message }, { status: 500 });
  }

  if (byPanelId && byPanelId.length > 0) {
    for (const row of byPanelId) {
      if (row.entry_id) void cleanupOrphanDeniedEntry(row.entry_id);
    }
    return new NextResponse(null, { status: 204 });
  }

  // Resolve slug → entry_id UUID before trying the entry_id fallback.
  // entry_id is a uuid column; passing a slug straight through throws a
  // Postgres type cast error and 500s. MCP's canvas_remove_entry tool
  // accepts slugs per its description, so support them here.
  let entryIdForFallback: string | null = UUID_REGEX.test(panelId) ? panelId : null;
  if (!entryIdForFallback) {
    const { data: bySlug } = await supabase
      .from("entries")
      .select("id")
      .eq("slug", panelId)
      .maybeSingle();
    if (bySlug?.id) entryIdForFallback = bySlug.id;
  }

  if (!entryIdForFallback) {
    // Neither panel_id, slug, nor UUID — treat as already-gone.
    return new NextResponse(null, { status: 204 });
  }

  // Fallback: delete by entry_id (legacy callers: chrome extension, MCP server).
  const { data: byEntryId, error: err2 } = await supabase
    .from("canvas_panels")
    .delete()
    .eq("user_id", userId)
    .eq("entry_id", entryIdForFallback)
    .select("id, entry_id");

  if (err2) {
    return NextResponse.json({ error: err2.message }, { status: 500 });
  }

  if (byEntryId && byEntryId.length > 0) {
    for (const row of byEntryId) {
      if (row.entry_id) void cleanupOrphanDeniedEntry(row.entry_id);
    }
    return new NextResponse(null, { status: 204 });
  }

  return new NextResponse(null, { status: 204 });
});

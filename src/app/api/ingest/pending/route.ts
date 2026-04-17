import { NextRequest, NextResponse } from "next/server";
import { withUserAuth } from "@/lib/auth/with-auth";
import { supabaseAdmin } from "@/lib/supabase";

/**
 * GET /api/ingest/pending
 *
 * Returns the caller's queued-but-not-yet-processed skeleton entries.
 * Consumed by the MCP server to assemble the `_dopl_status` footer that
 * is attached to every Dopl MCP tool response, plus the
 * `list_pending_ingests` tool.
 *
 * The MCP client caches this for ~5s per connection, so volume is low
 * even with chatty agents. Returns { pending_ingestions: N, recent: [] }.
 */
async function handleGet(
  _request: NextRequest,
  { userId }: { userId: string }
) {
  const supabase = supabaseAdmin();

  const { data, error } = await supabase
    .from("entries")
    .select("id, source_url, created_at")
    .eq("ingested_by", userId)
    .eq("status", "pending_ingestion")
    .order("created_at", { ascending: false })
    .limit(20);

  if (error) {
    return NextResponse.json(
      { error: "Failed to load pending ingestions", message: error.message },
      { status: 500 }
    );
  }

  const recent = (data ?? []).map((row) => ({
    entry_id: row.id,
    url: row.source_url,
    queued_at: row.created_at,
  }));

  return NextResponse.json({
    pending_ingestions: recent.length,
    recent,
  });
}

export const GET = withUserAuth(handleGet);

import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
const supabase = supabaseAdmin();
import { withUserAuth, isAdmin } from "@/lib/auth/with-auth";

async function handleGet(
  _request: NextRequest,
  { userId, params }: { userId: string; params?: Record<string, string> }
) {
  const id = params?.id;
  if (!id) {
    return NextResponse.json({ error: "id required" }, { status: 400 });
  }

  // Scope the lookup to the ingester (or admin) so we don't leak details
  // of other users' ingestions. Return 404 on mismatch to avoid hinting
  // at existence.
  let query = supabase
    .from("entries")
    .select("id, status, title, created_at, updated_at, ingested_at, ingested_by")
    .eq("id", id);

  if (!isAdmin(userId)) {
    query = query.eq("ingested_by", userId);
  }

  const { data: entry, error: entryError } = await query.single();

  if (entryError || !entry) {
    return NextResponse.json({ error: "Entry not found" }, { status: 404 });
  }

  const { data: logs } = await supabase
    .from("ingestion_logs")
    .select("step, status, details, created_at")
    .eq("entry_id", id)
    .order("created_at", { ascending: true });

  return NextResponse.json({
    entry_id: entry.id,
    status: entry.status,
    title: entry.title,
    created_at: entry.created_at,
    updated_at: entry.updated_at,
    ingested_at: entry.ingested_at,
    steps: logs || [],
  });
}

export const GET = withUserAuth(handleGet);

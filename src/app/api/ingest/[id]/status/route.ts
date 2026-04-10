import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  // Get entry status
  const { data: entry, error: entryError } = await supabase
    .from("entries")
    .select("id, status, title, created_at, updated_at, ingested_at")
    .eq("id", id)
    .single();

  if (entryError || !entry) {
    return NextResponse.json({ error: "Entry not found" }, { status: 404 });
  }

  // Get ingestion logs
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

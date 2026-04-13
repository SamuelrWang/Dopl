import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
const supabase = supabaseAdmin();
import { EntryUpdateSchema } from "@/types/api";
import { withExternalAuth } from "@/lib/auth/with-auth";

async function handleGet(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  const { data: entry, error } = await supabase
    .from("entries")
    .select("*")
    .eq("id", id)
    .single();

  if (error || !entry) {
    return NextResponse.json({ error: "Entry not found" }, { status: 404 });
  }

  // Get sources
  const { data: sources } = await supabase
    .from("sources")
    .select("*")
    .eq("entry_id", id)
    .order("depth", { ascending: true });

  // Get tags
  const { data: tags } = await supabase
    .from("tags")
    .select("tag_type, tag_value")
    .eq("entry_id", id);

  return NextResponse.json({
    ...entry,
    sources: sources || [],
    tags: tags || [],
  });
}

async function handlePatch(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const body = await request.json();
  const parsed = EntryUpdateSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid request", details: parsed.error.issues },
      { status: 400 }
    );
  }

  const { data, error } = await supabase
    .from("entries")
    .update({ ...parsed.data, updated_at: new Date().toISOString() })
    .eq("id", id)
    .select()
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json(data);
}

async function handleDelete(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  const { error } = await supabase.from("entries").delete().eq("id", id);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}

export const GET = withExternalAuth(handleGet);
export const PATCH = withExternalAuth(handlePatch);
export const DELETE = withExternalAuth(handleDelete);

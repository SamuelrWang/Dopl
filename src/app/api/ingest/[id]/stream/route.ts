import { NextRequest, NextResponse } from "next/server";
import { ingestionProgress } from "@/features/ingestion/server/progress";
import { withUserAuth, isAdmin } from "@/lib/auth/with-auth";
import { supabaseAdmin } from "@/lib/supabase";

const supabase = supabaseAdmin();

export const dynamic = "force-dynamic";

async function handleGet(
  _request: NextRequest,
  { userId, params }: { userId: string; params?: Record<string, string> }
) {
  const id = params?.id;
  if (!id) {
    return NextResponse.json({ error: "id required" }, { status: 400 });
  }

  // Ownership / admin gate. Returning 404 (not 403) avoids leaking
  // entry existence across users.
  const { data: entry } = await supabase
    .from("entries")
    .select("ingested_by, moderation_status")
    .eq("id", id)
    .single();
  if (!entry) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  const isOwner = entry.ingested_by === userId;
  const isPublic = entry.moderation_status === "approved";
  if (!isOwner && !isPublic && !isAdmin(userId)) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const stream = ingestionProgress.subscribe(id);

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}

export const GET = withUserAuth(handleGet);

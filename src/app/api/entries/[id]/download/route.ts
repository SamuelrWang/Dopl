import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/shared/supabase/admin";
const supabase = supabaseAdmin();
import { withUserAuth, isAdmin } from "@/shared/auth/with-auth";
import { resolveEntryId } from "@/lib/entries/resolver";

async function handleGet(
  request: NextRequest,
  { userId, params }: { userId: string; params?: Record<string, string> }
) {
  const input = params?.id;
  if (!input) {
    return NextResponse.json({ error: "Missing entry ID" }, { status: 400 });
  }
  const id = await resolveEntryId(input);
  if (!id) {
    return NextResponse.json({ error: "Entry not found" }, { status: 404 });
  }
  const file = request.nextUrl.searchParams.get("file") || "agents_md";

  const { data: entry, error } = await supabase
    .from("entries")
    .select("title, readme, agents_md, manifest, content_type, moderation_status, ingested_by")
    .eq("id", id)
    .single();

  if (error || !entry) {
    return NextResponse.json({ error: "Entry not found" }, { status: 404 });
  }

  // Moderation gate: only approved entries are downloadable by the public.
  // Owner and admin can always download.
  if (entry.moderation_status !== "approved") {
    const isOwner = entry.ingested_by && entry.ingested_by === userId;
    if (!isOwner && !isAdmin(userId)) {
      return NextResponse.json({ error: "Entry not found" }, { status: 404 });
    }
  }

  let content: string;
  let filename: string;
  let contentType: string;

  switch (file) {
    case "readme":
      content = entry.readme || "";
      filename = "README.md";
      contentType = "text/markdown";
      break;
    case "manifest":
      content = JSON.stringify(entry.manifest, null, 2);
      filename = "manifest.json";
      contentType = "application/json";
      break;
    case "agents_md":
    default: {
      content = entry.agents_md || "";
      const ct = entry.content_type;
      if (ct === "knowledge" || ct === "article") {
        filename = "key-insights.md";
      } else if (ct === "reference") {
        filename = "reference-guide.md";
      } else {
        filename = "agents.md";
      }
      contentType = "text/markdown";
      break;
    }
  }

  return new Response(content, {
    headers: {
      "Content-Type": contentType,
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  });
}

export const GET = withUserAuth(handleGet);

import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import { withExternalAuth } from "@/lib/auth/with-auth";

async function handleGet(
  request: NextRequest,
  context: unknown
) {
  const { id } = await (context as { params: Promise<{ id: string }> }).params;
  const file = request.nextUrl.searchParams.get("file") || "agents_md";

  const { data: entry, error } = await supabase
    .from("entries")
    .select("title, readme, agents_md, manifest")
    .eq("id", id)
    .single();

  if (error || !entry) {
    return NextResponse.json({ error: "Entry not found" }, { status: 404 });
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
    default:
      content = entry.agents_md || "";
      filename = "agents.md";
      contentType = "text/markdown";
      break;
  }

  return new Response(content, {
    headers: {
      "Content-Type": contentType,
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  });
}

export const GET = withExternalAuth(handleGet);

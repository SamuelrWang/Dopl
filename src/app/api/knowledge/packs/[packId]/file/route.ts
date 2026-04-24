import { NextResponse } from "next/server";
import { withMcpAccess } from "@/shared/auth/with-auth";
import { supabaseAdmin } from "@/shared/supabase/admin";

const supabase = supabaseAdmin();

/**
 * GET /api/knowledge/packs/[packId]/file?path=docs/sdk/camera.md
 *
 * Fetch one file's full body. The file path is a query param (not a
 * catch-all path segment) so the wrapper's `Record<string, string>` param
 * typing stays simple — the path can contain slashes either way and the
 * MCP client URL-encodes it.
 */
export const GET = withMcpAccess("kb_get", async (request, { params }) => {
  const packId = params?.packId;
  if (!packId) {
    return NextResponse.json({ error: "packId is required" }, { status: 400 });
  }

  const url = new URL(request.url);
  const path = url.searchParams.get("path");
  if (!path) {
    return NextResponse.json({ error: "path query param is required" }, { status: 400 });
  }

  const { data, error } = await supabase
    .from("knowledge_pack_files")
    .select("*")
    .eq("pack_id", packId)
    .eq("path", path)
    .maybeSingle();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  if (!data) {
    return NextResponse.json({ error: "File not found" }, { status: 404 });
  }

  return NextResponse.json({ file: data });
});

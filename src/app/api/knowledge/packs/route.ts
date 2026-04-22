import { NextResponse } from "next/server";
import { withMcpAccess } from "@/lib/auth/with-auth";
import { supabaseAdmin } from "@/lib/supabase";

const supabase = supabaseAdmin();

/**
 * GET /api/knowledge/packs — list all installed knowledge packs.
 *
 * Visible to every authenticated MCP user. Per-user filtering (only the
 * packs a user has explicitly enabled) is deferred to V2.
 */
export const GET = withMcpAccess("kb_list_packs", async () => {
  const { data, error } = await supabase
    .from("knowledge_packs")
    .select("id, name, description, sdk_version, repo_url, last_synced_at, last_commit_sha")
    .order("id", { ascending: true });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ packs: data ?? [] });
});
